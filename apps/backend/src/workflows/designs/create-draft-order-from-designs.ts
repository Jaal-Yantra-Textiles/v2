import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { DESIGN_MODULE } from "../../modules/designs"
import { readHouseStore } from "../production-runs/house-store"
import { resolveMintSalesChannel } from "./lib/mint-sales-channel"
import { applyRate, fetchExchangeRate } from "../../lib/fx/exchange-rate"
import {
  estimateDesignCostWorkflow,
  EstimateCostOutput,
} from "./estimate-design-cost"

// ─── Types ───────────────────────────────────────────────────────────────────

type CreateDraftOrderFromDesignsInput = {
  /**
   * Who the order is for — or `null` for a draft with no buyer attached yet
   * (#1817). Most designs carry no customer link, and a cart is perfectly able
   * to acquire one later, at checkout or when the order is claimed.
   */
  customer_id: string | null
  design_ids: string[]
  currency_code?: string
  price_overrides?: Record<string, number>
  /** Currency of price_overrides (e.g. "inr"). Defaults to store default. */
  override_currency?: string
  /**
   * 🔴 ISO-2 the buyer is purchasing from. Optional, and a cart without it is
   * BROKEN rather than merely incomplete: the checkout link cannot be built,
   * a hand-written one is re-regioned to `countries[0]` (Albania, in prod),
   * and `/store/shipping-options` cannot geo-filter, so an Indian courier is
   * offered to a European buyer.
   */
  country_code?: string
}

import { resolveDesignThumbnail } from "../../lib/design-thumbnail"

type DesignEstimate = {
  design_id: string
  name: string
  unit_price: number
  confidence: string
  /**
   * The design's picture, resolved at collation time. Null is ordinary — most
   * designs have no image yet.
   */
  thumbnail?: string | null
  /** Currency this estimate is denominated in (set by estimate step) */
  source_currency?: string
  original_price?: number
  original_currency?: string
}


/**
 * PURE: what currency is this design's estimate denominated in? (#2176)
 *
 * 🔴 The answer is the DESIGN'S `cost_currency`, and it was being guessed from
 * the house store instead.
 *
 * `estimate-design-cost` prices in the design's own currency — its doc says so
 * outright ("unit_amount is always per finished unit, in the design's cost
 * currency") and it matches comparable variant prices on that currency. The
 * draft-order step tagged the estimate with nothing and left the conversion
 * step to fall back on the house store, which is EUR while 12 of 15 storefronts
 * sell in INR. A design costed at ₹10,000 with `cost_currency: "inr"` written
 * on it was therefore read as €10,000 and converted into the rupee cart.
 *
 * Returns `undefined` — not a guess — when the design carries no currency, so
 * the caller's existing fallback still covers rows that predate the column.
 * An empty string is treated as absent: `''` is not a denomination, and
 * letting it through would label money with nothing.
 */
export function estimateSourceCurrency(
  design: { cost_currency?: string | null } | null | undefined
): string | undefined {
  const raw = design?.cost_currency
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return trimmed ? trimmed.toLowerCase() : undefined
}

// ─── Step 1: Estimate costs for each design ──────────────────────────────────

const estimateDesignCostsStep = createStep(
  "estimate-design-costs-step",
  async (
    input: {
      design_ids: string[]
      price_overrides?: Record<string, number>
      override_currency?: string
    },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const overrides = input.price_overrides || {}

    const estimates: DesignEstimate[] = []

    for (const design_id of input.design_ids) {
      const { data: designs } = await query.graph({
        entity: "design",
        filters: { id: design_id },
        // 🔴 `cost_currency` is what the estimate is DENOMINATED IN. Without it
        // the conversion step below falls back to the house store's currency
        // and a rupee estimate gets read as euros. #2176
        //
        // The rest feed `resolveDesignThumbnail`. A design line has NO VARIANT,
        // so the storefront's `item.variant.product.images[0]` fallback is null
        // by construction — if the line does not carry a thumbnail, the buyer
        // checks out looking at a grey placeholder, which is what every design
        // order did until now.
        fields: [
          "id",
          "name",
          "cost_currency",
          "thumbnail_url",
          "media_files",
          "moodboard",
          "metadata",
        ],
      })

      const design = designs?.[0]
      if (!design) {
        throw new Error(`Design not found: ${design_id}`)
      }

      if (design_id in overrides) {
        estimates.push({
          design_id,
          name: design.name,
          unit_price: overrides[design_id],
          confidence: "manual",
          thumbnail: resolveDesignThumbnail(design as any),
          // Tag with the override currency so the conversion step knows
          source_currency: input.override_currency?.toLowerCase(),
        })
      } else {
        const { result: costEstimate } = await estimateDesignCostWorkflow(
          container
        ).run({ input: { design_id } }) as { result: EstimateCostOutput }

        /**
         * 🔴 Refuse rather than put a zero on an order line.
         *
         * `total_estimated` is null when the estimator had nothing to price
         * from — no bill of materials, no order history. It used to be 0, which
         * went onto the draft order as a real unit price and read as a
         * deliberate freebie. The caller already has the remedy: pass this
         * design in `overrides` with a price someone actually decided. #1564
         */
        if (costEstimate.total_estimated == null) {
          throw new Error(
            `Cannot price design "${design.name}" (${design_id}): it has no bill of materials and no cost history. Supply a price for it in overrides.`
          )
        }

        estimates.push({
          design_id,
          name: design.name,
          unit_price: costEstimate.total_estimated,
          confidence: costEstimate.confidence,
          thumbnail: resolveDesignThumbnail(design as any),
          /**
           * 🔴 The estimate is in the DESIGN'S cost currency, not the store's.
           *
           * This used to be tagged with nothing, under the comment "estimation
           * results are in store default currency". They are not:
           * `estimate-design-cost` prices in `design.cost_currency` and says so
           * ("unit_amount is always per finished unit, in the design's cost
           * currency"), and it even matches comparable variant prices on that
           * currency.
           *
           * An untagged estimate falls through to the house store's currency,
           * which is EUR while 12 of 15 storefronts sell in INR. So a design
           * costed at ₹10,000 — `cost_currency: "inr"`, written on the design —
           * was read as €10,000 and FX-converted into the rupee cart. The line
           * kept the evidence in its own metadata: `original_currency: "eur"`
           * on an `inr` cart (#2176).
           *
           * Left undefined when the design carries no currency, which keeps the
           * old fallback for rows that predate the column rather than inventing
           * a denomination for them.
           */
          source_currency: estimateSourceCurrency(design),
        })
      }
    }

    return new StepResponse({ estimates })
  }
)

// ─── Step 2: Convert estimates to target currency ───────────────────────────
//
// Fetches live exchange rates from the Frankfurter API (ECB data, free, no key).
// Rates update once per business day. Results are cached in-memory for 1 hour.
//
// Handles two source currencies:
//   - Estimated prices: assumed to be in store default currency
//   - Manual overrides: in override_currency (if provided), else store default

const convertEstimateCurrencyStep = createStep(
  "convert-estimate-currency-step",
  async (
    input: {
      estimates: DesignEstimate[]
      target_currency: string
    },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const targetCurrency = (input.target_currency || "inr").toLowerCase()

    /**
     * The FX base currency.
     *
     * 🔴 Was `stores[0]` with `filters: {}`. The intent — "partner-less context,
     * so the platform store's currency is the correct base" — was right; the
     * read was not. On 14 stores, row 0 is whichever Postgres returned first.
     * `readHouseStore` resolves the store that is NOT a partner tenant, and
     * returns null rather than guessing when that is not one unambiguous row.
     * #2064
     */
    const house = await readHouseStore(container)
    const defaultCurrency = (house?.defaultCurrency || "inr").toLowerCase()

    // Collect unique source currencies we need rates for
    const sourceCurrencies = new Set<string>()
    for (const est of input.estimates) {
      const src = est.source_currency || defaultCurrency
      if (src !== targetCurrency) {
        sourceCurrencies.add(src)
      }
    }

    // If no conversion needed for any estimate, return as-is
    if (sourceCurrencies.size === 0) {
      return new StepResponse({
        estimates: input.estimates,
        exchange_rate: 1,
        base_currency: defaultCurrency,
        target_currency: targetCurrency,
      })
    }

    // Fetch exchange rates for each unique source currency → target
    const rates: Record<string, number> = {}
    for (const src of sourceCurrencies) {
      rates[src] = await fetchExchangeRate(src, targetCurrency)
    }

    const converted: DesignEstimate[] = input.estimates.map((est) => {
      const srcCurrency = est.source_currency || defaultCurrency
      const rate = rates[srcCurrency] ?? 1

      if (rate === 1 && srcCurrency === targetCurrency) {
        // No conversion needed for this estimate
        return { ...est, source_currency: undefined }
      }

      return {
        ...est,
        original_price: est.unit_price,
        original_currency: srcCurrency,
        unit_price: applyRate(est.unit_price, rate),
        source_currency: undefined,
      }
    })

    return new StepResponse({
      estimates: converted,
      exchange_rate: Object.values(rates)[0] ?? 1,
      base_currency: defaultCurrency,
      target_currency: targetCurrency,
    })
  }
)

// ─── Step 3: Create cart with design line items ──────────────────────────────

const createDesignCartStep = createStep(
  "create-design-cart-step",
  async (
    input: {
      customer_id: string | null
      currency_code?: string
      /** ISO-2 the buyer purchases from; only applied if the region serves it. */
      country_code?: string
      estimates: DesignEstimate[]
    },
    { container }
  ) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const cartService = container.resolve(Modules.CART) as any

    const currencyCode = input.currency_code || "inr"

    // Find a region that supports this currency
    const { data: regions } = await query.graph({
      entity: "region",
      filters: {},
      // `countries.iso_2` is required, not decorative: the country guard below
      // checks membership against it, and without it the guard rejects EVERY
      // country silently and the cart is created address-less exactly as before.
      fields: ["id", "currency_code", "countries.iso_2"],
    })

    /**
     * 🔴 Was `... || regions?.[0]`. A cart whose region's currency differs from
     * the cart's own currency is not a near-miss — the region decides tax and
     * what the buyer is actually charged in, so falling back to an arbitrary
     * region prices the order in one currency and taxes it as another.
     *
     * No region for the currency is an unanswered question, and at the till an
     * unanswered question stops. #1564, #2064
     */
    const region = regions?.find((r: any) => r.currency_code === currencyCode)

    if (!region) {
      throw new Error(
        `No region is configured for ${currencyCode.toUpperCase()}, so a cart cannot be ` +
          `created in it. Create a region for that currency, or pass a currency one of ` +
          `the ${regions?.length ?? 0} existing regions supports.`
      )
    }

    /**
     * 🔴 Was `stores[0].default_sales_channel_id`, and when that was absent it
     * literally took the first row of `sales_channel` with no filter — "find
     * any sales channel". On a 14-store platform that puts an admin's design
     * order into whichever tenant's catalogue happened to sort first.
     *
     * This is a house-side draft order, so the house store's channel is the
     * answer. `resolveMintSalesChannel` is the same resolver the design→product
     * minter uses (#2059), so the two cannot disagree about where house work
     * belongs — and it refuses rather than picking a row. #2064
     */
    const channel = await resolveMintSalesChannel(container, {})
    const salesChannelId = channel.sales_channel_id
    if (!salesChannelId) {
      /**
       * 🔴 The remedy is NOT the same for both reasons, and naming the wrong
       * one costs an afternoon.
       *
       * #2100: an E2E fixture had claimed the house store for a test partner,
       * so the reason was `no_house_store` — there was no house store to give a
       * channel to — while this message said "the house store needs a default
       * sales channel" and sent the reader to the sales-channel screen of a
       * store that was fine. `readHouseStore` now logs the store counts when it
       * refuses; this says which question to take to them.
       */
      const remedy =
        channel.reason === "no_house_store"
          ? `There is no single store belonging to no partner — either a partner has claimed ` +
            `the house store (dismiss that partner-stores-link), or more than one store is ` +
            `ownerless. The [house-store] log line names the candidates.`
          : `The house store has no default sales channel. Set one on it.`
      throw new Error(
        `Cannot create a design order cart: no sales channel could be resolved ` +
          `(${channel.reason}). ${remedy}`
      )
    }

    /**
     * The customer's email, when there IS a customer.
     *
     * 🔴 Guarded on presence. `filters: { id: undefined }` is NOT "no rows" —
     * an absent filter matches EVERYTHING, so a customer-less draft would have
     * picked up whichever customer the database returned first and put a
     * stranger's address on the order.
     */
    let customerEmail: string | undefined = undefined
    if (input.customer_id) {
      const { data: customers } = await query.graph({
        entity: "customer",
        filters: { id: input.customer_id },
        fields: ["id", "email"],
      })
      customerEmail = customers?.[0]?.email
    }

    // Create the cart
    /**
     * ⚠️ COUNTRY ONLY — never a fabricated street, city or postcode.
     *
     * The rule below still holds: an invented address is an unreachable buyer
     * on a real order. But the country is not invented, it is ASKED FOR at
     * mint time, and without it the cart cannot produce a checkout link or
     * filter its own shipping options. Checkout collects the rest.
     *
     * Only set when the region actually serves it — otherwise the storefront
     * re-regions anyway and we have written a number that changes nothing.
     */
    const buyerCountry = String(input.country_code ?? "").trim().toLowerCase()
    const regionServes = (region.countries ?? []).map((c: any) =>
      String(c?.iso_2 ?? "").trim().toLowerCase()
    )
    const shippingAddress =
      buyerCountry && regionServes.includes(buyerCountry)
        ? { country_code: buyerCountry }
        : undefined

    const cart = await cartService.createCarts({
      region_id: region.id,
      currency_code: currencyCode,
      customer_id: input.customer_id ?? null,
      ...(shippingAddress ? { shipping_address: shippingAddress } : {}),
      // Null, never a placeholder: an invented address is an unreachable buyer
      // on a real order. Checkout collects it.
      email: customerEmail ?? null,
      sales_channel_id: salesChannelId,
      metadata: {
        created_by: "admin",
        source: "design-order",
      },
    })

    // Add custom-priced line items for each design
    const lineItems = await cartService.addLineItems(
      cart.id,
      input.estimates.map((est) => ({
        title: est.name,
        // Snapshot, like `title` and `unit_price` beside it: the line records
        // what was bought, so a later edit to the design does not repaint an
        // order already placed.
        thumbnail: est.thumbnail ?? null,
        unit_price: est.unit_price,
        is_custom_price: true,
        // #1195: MUST stay false on the CART. `completeCartWorkflow` runs
        // `validateShippingStep`, which demands a shipping method whose
        // profile matches `item.variant.product.shipping_profile.id` — these
        // items are custom-priced with no variant, so a `true` here makes
        // checkout unsatisfiable. The flag is repaired at order.placed
        // instead; see `src/lib/requires-shipping.ts`.
        requires_shipping: false,
        quantity: 1,
        metadata: {
          design_id: est.design_id,
          cost_confidence: est.confidence,
          ...(est.original_price != null && {
            original_currency: est.original_currency,
            original_amount: est.original_price,
          }),
        },
      }))
    )

    return new StepResponse(
      { cart, lineItems },
      cart.id
    )
  },
  async (cartId, { container }) => {
    if (!cartId) return
    const cartService = container.resolve(Modules.CART) as any
    try {
      await cartService.deleteCarts(cartId)
    } catch {
      // Cart may have been completed already
    }
  }
)

// ─── Step 4: Link designs to cart line items ─────────────────────────────────

const linkDesignsToLineItemsStep = createStep(
  "link-designs-to-line-items-step",
  async (
    input: {
      estimates: DesignEstimate[]
      lineItems: any[]
    },
    { container }
  ) => {
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

    const links: any[] = []
    for (let i = 0; i < input.estimates.length; i++) {
      const lineItem = input.lineItems[i]
      if (lineItem) {
        links.push({
          [DESIGN_MODULE]: { design_id: input.estimates[i].design_id },
          [Modules.CART]: { line_item_id: lineItem.id },
        })
      }
    }

    if (links.length > 0) {
      await remoteLink.create(links)
    }

    return new StepResponse(
      null,
      links
    )
  },
  async (links, { container }) => {
    if (!links || links.length === 0) return
    const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
    await remoteLink.dismiss(links)
  }
)

// ─── Workflow ─────────────────────────────────────────────────────────────────

export const createDraftOrderFromDesignsWorkflow = createWorkflow(
  "create-draft-order-from-designs",
  (input: CreateDraftOrderFromDesignsInput) => {
    const estimatesResult = estimateDesignCostsStep({
      design_ids: input.design_ids,
      price_overrides: input.price_overrides,
      override_currency: input.override_currency,
    })

    // Convert prices from source currency to target currency
    const convertedResult = convertEstimateCurrencyStep({
      estimates: estimatesResult.estimates as unknown as DesignEstimate[],
      target_currency: input.currency_code as unknown as string,
    })

    const cartResult = createDesignCartStep({
      customer_id: input.customer_id,
      currency_code: input.currency_code,
      country_code: input.country_code,
      estimates: convertedResult.estimates as unknown as DesignEstimate[],
    })

    linkDesignsToLineItemsStep({
      estimates: convertedResult.estimates as unknown as DesignEstimate[],
      lineItems: cartResult.lineItems,
    })

    return new WorkflowResponse(cartResult.cart)
  }
)

export default createDraftOrderFromDesignsWorkflow

// ─── Exported for use in store checkout route ────────────────────────────────

/**
 * Kept as a re-export: the implementation moved to `lib/fx/exchange-rate.ts`
 * when the B2B quote line override became its second caller (#1439 S7). A
 * quote path must not import a designs workflow to convert a currency.
 */
export { fetchExchangeRate, applyRate }
