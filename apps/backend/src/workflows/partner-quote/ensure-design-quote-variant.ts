import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { linkProductsToSalesChannelWorkflow } from "@medusajs/medusa/core-flows"

import { applyRate, fetchExchangeRate } from "../../lib/fx/exchange-rate"
import { designQuoteUnitPrice } from "../../modules/partner-quote/lib/design-quote-price"
import {
  isMadeToOrderDesignProduct,
  resolveDesignVariants,
} from "../../modules/partner-quote/lib/design-lines"
import { estimateDesignCostWorkflow } from "../designs/estimate-design-cost"
import { createProductFromDesignWorkflow } from "../designs/create-product-from-design"

/**
 * Make a CUSTOM design quotable, without inventing a second pricing path.
 *
 * ## The problem this solves
 *
 * A design could only be quoted once a product existed behind it, because
 * `resolveDesignVariants` resolves a design to the VARIANT it is sold through
 * and everything downstream — tiers, the minted price list, freight weight,
 * the accepted cart — is keyed on that variant. A design whose production run
 * is in the FUTURE has no product, so the picker greyed it out and told the
 * partner to go and create one, which is a real step they have to do by hand
 * for work they have not sold yet.
 *
 * ## Why minting a variant rather than quoting the design directly
 *
 * The obvious alternative is a quote line that carries the design's estimated
 * cost and no variant. It is the wrong shape:
 *
 * - `planQuotePrices` DROPS any line with no `variant_id`, deliberately, so the
 *   quote would mint a price list that prices nothing;
 * - `accept-quote` builds a real cart from `variant_id` line items, so there
 *   would be nothing to accept;
 * - and it would be the second way to arrive at a number the buyer pays, which
 *   is exactly what `design-lines.ts` refuses.
 *
 * So the estimate becomes the PRICE OF A VARIANT, once, here — and from that
 * point on a custom design is quoted by the same machinery as everything else.
 *
 * ## What it refuses
 *
 * 🔴 A design that cannot be priced does NOT get a variant. Minting one at a
 * price of zero, or at "we could not tell", would put an active price row in
 * front of a buyer — the #1564 failure with an extra step. The refusal carries
 * the estimator's own words so the partner learns what is missing.
 */

export type EnsureDesignQuoteVariantInput = {
  design_id: string
  /** The currency the quote is denominated in. */
  currency_code: string
  /** Scopes visibility. Omit on the admin surface, as the picker does. */
  partner_id?: string | null
  /** Override the 20% uplift. The wizard does not; ops might. */
  markup_percent?: number
  /**
   * The catalogue the minted product belongs in — the quoting partner's
   * default sales channel.
   *
   * 🔑 Deliberately NOT `partner_id`. That field scopes VISIBILITY, and on the
   * admin surface it is passed as null on purpose: a design is not owned by
   * anyone before a production run, so an admin quotes any design for any
   * partner. Whose catalogue the product lands in is a different question with
   * a different answer, and folding the two together would either re-scope the
   * picker or put the product in nobody's catalogue — which is exactly what
   * happened while this input did not exist.
   */
  catalogue_sales_channel_id?: string | null
  /**
   * Answer the question without creating anything.
   *
   * 🔑 The readiness preflight uses this. A preflight that MINTS a product as
   * a side effect of being asked "would this work" leaves real catalogue rows
   * behind every time a partner opens the wizard and changes their mind — and
   * the whole reason readiness exists is that it is safe to ask.
   */
  dry_run?: boolean
}

export type EnsureDesignQuoteVariantOutput = {
  design_id: string
  variant_id: string | null
  product_id: string | null
  /** True when this call created the variant rather than finding it. */
  minted: boolean
  /** The listed unit price, in `currency_code`. Null when nothing was minted. */
  unit_price: number | null
  /** The estimator's confidence in the cost the price was built from. */
  confidence: string | null
  /** Which rung of the estimator produced the figure. */
  basis: string | null
  /** Why no variant exists, in words for a partner. Null on success. */
  reason: string | null
  /**
   * True when a variant WOULD be minted but was not, because this was a dry
   * run. `variant_id` is null and `unit_price` is the price it would carry.
   */
  mintable: boolean
}

const ensureVariantStep = createStep(
  "ensure-design-quote-variant-step",
  async (input: EnsureDesignQuoteVariantInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const resolutions = await resolveDesignVariants(container, {
      design_ids: [input.design_id],
      partner_id: input.partner_id ?? null,
    })
    const resolution = resolutions.get(input.design_id)

    if (!resolution?.visible) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        resolution?.reason ?? `Design ${input.design_id} does not exist.`
      )
    }

    /**
     * 🔑 Idempotent, and it has to be: this runs from a picker a partner can
     * click twice, and `link.create` is not idempotent — a second mint would
     * leave the design resolving to TWO variants, which makes it unquotable
     * for the opposite reason to the one we came here to fix.
     */
    if (resolution.variant_id) {
      const candidate = resolution.candidates.find(
        (c) => c.variant_id === resolution.variant_id
      )
      return new StepResponse({
        design_id: input.design_id,
        variant_id: resolution.variant_id,
        product_id: candidate?.product_id ?? null,
        minted: false,
        unit_price: null,
        confidence: null,
        basis: null,
        reason: null,
        mintable: false,
      } as EnsureDesignQuoteVariantOutput)
    }

    /**
     * Several candidates is NOT a case for minting. The partner has to pick,
     * exactly as before — creating a sixth variant to sidestep the question
     * would quote a size nobody chose on a document a buyer signs.
     */
    if (resolution.candidates.length > 1) {
      return new StepResponse({
        design_id: input.design_id,
        variant_id: null,
        product_id: null,
        minted: false,
        unit_price: null,
        confidence: null,
        basis: null,
        reason: resolution.reason,
        mintable: false,
      } as EnsureDesignQuoteVariantOutput)
    }

    // ── No product at all. Price it, or refuse. ────────────────────────────
    const { result: estimate } = await estimateDesignCostWorkflow(container).run({
      input: {
        design_id: input.design_id,
        // The whole point: a design with no run, no sample and no BOM is
        // priced from what comparable work has cost, labelled as a guess.
        allow_historical_basis: true,
      },
    })

    const { data: designs = [] } = await query.graph({
      entity: "design",
      fields: ["id", "name", "cost_currency"],
      filters: { id: input.design_id },
    })
    const design = (designs as any[])[0]

    const from = String(design?.cost_currency ?? input.currency_code).toLowerCase()
    const to = String(input.currency_code).toLowerCase()

    /**
     * ⚠️ `undefined` means no conversion is needed; `null` means one was
     * attempted and FAILED. `designQuoteUnitPrice` treats them differently on
     * purpose — collapsing them would quote a rupee figure as dollars.
     */
    let fxRate: number | null | undefined = undefined
    if (from && to && from !== to) {
      try {
        fxRate = await fetchExchangeRate(from, to)
      } catch {
        fxRate = null
      }
      if (!Number.isFinite(Number(fxRate)) || Number(fxRate) <= 0) fxRate = null
    }

    const priced = designQuoteUnitPrice({
      total_estimated: estimate?.total_estimated,
      confidence: estimate?.confidence,
      fx_rate: fxRate,
      markup_percent: input.markup_percent,
    })

    if (priced.unit_price === null) {
      // 🔴 No variant. A design we cannot price must cost nothing and leave
      // nothing behind, exactly like a variant that does not exist.
      return new StepResponse({
        design_id: input.design_id,
        variant_id: null,
        product_id: null,
        minted: false,
        unit_price: null,
        confidence: estimate?.confidence ?? null,
        basis: estimate?.breakdown?.production_cost_source ?? null,
        reason: priced.reason,
        mintable: false,
      } as EnsureDesignQuoteVariantOutput)
    }

    /**
     * Priced, and that is the whole answer a preflight needs. Stopping here
     * keeps "would this work" free of consequences.
     */
    if (input.dry_run) {
      return new StepResponse({
        design_id: input.design_id,
        variant_id: null,
        product_id: null,
        minted: false,
        unit_price: priced.unit_price,
        confidence: estimate?.confidence ?? null,
        basis: estimate?.breakdown?.production_cost_source ?? null,
        reason: null,
        mintable: true,
      } as EnsureDesignQuoteVariantOutput)
    }

    const { result: created } = await createProductFromDesignWorkflow(
      container
    ).run({
      input: {
        design_id: input.design_id,
        // Legacy field. `unit_price` is what actually gets listed — see the
        // docblock on that input for why the two differ.
        estimated_cost: Number(estimate?.total_estimated ?? 0),
        unit_price: priced.unit_price,
        currency_code: to,
        made_to_order: true,
        // Whose catalogue this is. Without it the product went to whichever
        // store came back first from `listStores({})`.
        sales_channel_id: input.catalogue_sales_channel_id ?? null,
      } as any,
    })

    return new StepResponse({
      design_id: input.design_id,
      variant_id: (created as any)?.variant_id ?? null,
      product_id: (created as any)?.product_id ?? null,
      minted: true,
      unit_price: priced.unit_price,
      confidence: estimate?.confidence ?? null,
      basis: estimate?.breakdown?.production_cost_source ?? null,
      reason: null,
      mintable: true,
    } as EnsureDesignQuoteVariantOutput)
  }
)

export const ensureDesignQuoteVariantWorkflow = createWorkflow(
  "ensure-design-quote-variant",
  (input: EnsureDesignQuoteVariantInput) => {
    return new WorkflowResponse(ensureVariantStep(input))
  }
)

/**
 * Build the port `design-lines.ts` calls to mint or preview a made-to-order
 * variant.
 *
 * It lives here, next to the workflow, because the routes already import
 * workflows freely and `design-lines.ts` deliberately imports none — see
 * `DesignVariantPort` for why that matters to its unit tests.
 */
export function makeDesignVariantPort(
  scope: any,
  config: {
    currency_code: string
    partner_id?: string | null
    markup_percent?: number
    /** The quoting partner's catalogue. See `catalogue_sales_channel_id`. */
    catalogue_sales_channel_id?: string | null
  }
) {
  return async (input: { design_id: string; dry_run: boolean }) => {
    const { result } = await ensureDesignQuoteVariantWorkflow(scope).run({
      input: {
        design_id: input.design_id,
        currency_code: config.currency_code,
        partner_id: config.partner_id ?? null,
        markup_percent: config.markup_percent,
        catalogue_sales_channel_id: config.catalogue_sales_channel_id ?? null,
        dry_run: input.dry_run,
      },
    })

    const out = result as EnsureDesignQuoteVariantOutput
    return {
      variant_id: out?.variant_id ?? null,
      unit_price: out?.unit_price ?? null,
      confidence: out?.confidence ?? null,
      basis: out?.basis ?? null,
      reason: out?.reason ?? null,
    }
  }
}

/**
 * Put every made-to-order design product in this basket into the quoting
 * partner's catalogue.
 *
 * ## Why minting into the right channel is not enough on its own
 *
 * `ensureDesignQuoteVariant` is idempotent by design: a design that already
 * resolves to a variant returns straight away and creates nothing. That is
 * correct — a second mint would attach a SECOND variant to the design and make
 * it unquotable for the opposite reason. But it means the channel fix on the
 * mint path only ever reaches designs quoted for the FIRST time, and every
 * design already carrying a product stays in whatever catalogue it was born
 * in. All 12 on production were born in the wrong one.
 *
 * It is also the case that genuinely needs handling twice over: a design is not
 * owned by any partner before a production run, so the same made-to-order
 * product can legitimately be quoted by two different partners. Sales-channel
 * membership is many-to-many precisely so that both can be true, which is why
 * this ADDS and never replaces.
 *
 * 🔴 `isMadeToOrderDesignProduct` is the whole safety boundary. Only a product
 * the quote flow itself minted qualifies; a design that resolves through
 * `product_design` points at a real catalogue product someone else owns, and
 * adding that to this partner's channel would be a cross-tenant catalogue
 * write. It is skipped, and `assertVariantsInStore` refuses it a moment later,
 * which is the correct answer.
 *
 * Writes only what is missing — `link.create` is not idempotent, so a product
 * already in the channel is filtered out rather than re-linked.
 */
export async function ensureDesignProductsInCatalogue(
  scope: any,
  input: {
    lines: Array<{ variant_id?: string | null; design_id?: string | null }>
    sales_channel_id?: string | null
  }
): Promise<{ added_product_ids: string[] }> {
  const salesChannelId = input.sales_channel_id || null
  if (!salesChannelId) return { added_product_ids: [] }

  const variantIds = Array.from(
    new Set(
      (input.lines ?? [])
        .filter((l) => l?.design_id && l?.variant_id)
        .map((l) => String(l.variant_id))
    )
  )
  // `filters: { id: [] }` is NO filter, not "no rows" (#1433) — this would
  // otherwise read every variant on the platform.
  if (!variantIds.length) return { added_product_ids: [] }

  const query = scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: variants = [] } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "product.id",
      "product.metadata",
      "product.sales_channels.id",
    ],
    filters: { id: variantIds },
  })

  const productIds = new Set<string>()
  for (const variant of (variants ?? []) as any[]) {
    const product = variant?.product
    if (!product?.id) continue
    // Quoted from a design line by construction — that is how it got here.
    if (!isMadeToOrderDesignProduct(product, true)) continue
    const channels = (product.sales_channels ?? []) as any[]
    if (channels.some((c) => c?.id === salesChannelId)) continue
    productIds.add(product.id)
  }

  if (!productIds.size) return { added_product_ids: [] }

  const added = Array.from(productIds)
  await linkProductsToSalesChannelWorkflow(scope).run({
    input: { id: salesChannelId, add: added },
  })

  return { added_product_ids: added }
}

export default ensureDesignQuoteVariantWorkflow
