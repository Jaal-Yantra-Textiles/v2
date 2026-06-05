import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateStoresWorkflow } from "@medusajs/medusa/core-flows"
import partnerRegionLink from "../../links/partner-region"
import fanoutPricesWorkflow from "../fx/fanout-prices"

/**
 * Workflow: propagate-region-to-partners
 *
 * When admin creates (or updates) a region, every active partner needs
 * the same plumbing the 0A backfill did manually:
 *   1. `partner_region` link from the partner to the region.
 *   2. `store.supported_currencies` extended with the region's
 *      currency_code if missing.
 *   3. (Optional) FX fanout against every existing variant price on
 *      the partner's store so converted price rows materialize in the
 *      new currency.
 *
 * Called by:
 *   - `src/subscribers/region-propagate.ts` on `region.created`.
 *   - `POST /admin/regions/:id/share-to-all` for manual re-runs.
 *
 * Companion of `src/scripts/backfill-all-admin-regions-to-partners.ts`
 * and friends — those are the one-off batch path for retrofitting the
 * existing platform; this workflow is the structural fix so new
 * regions self-propagate.
 *
 * Idempotent: skips link pairs that already exist, skips currencies
 * already in supported_currencies, and the FX workflow has its own
 * recursion guard on auto-derived prices. Safe to re-run.
 */

export type PropagateRegionInput = {
  /** Region whose state should propagate to partners. */
  region_id: string
  /**
   * Optional: scope to a subset of partners. Default = every partner
   * with at least one store.
   */
  partner_ids?: string[]
  /**
   * When true, also kick off FX fanout against every existing variant
   * price on the affected stores so converted rows materialize for the
   * new currency immediately. Default false (cheap path: partners' next
   * variant save will fan out automatically).
   */
  trigger_fanout?: boolean
}

export type PropagateRegionOutput = {
  region_id: string
  /** Number of (partner, region) link rows created. */
  links_created: number
  /** Number of (partner, region) pairs that already had a link. */
  links_already_existing: number
  /** Number of stores that had their supported_currencies extended. */
  stores_currency_updated: number
  /** Number of stores already covering the region currency. */
  stores_currency_already_current: number
  /** Number of stores without the new region currency that had it added. */
  fanout_invocations: number
  fanout_created_prices: number
  fanout_errors: number
  errors: Array<{ partner_id: string; phase: string; error: string }>
}

const propagateStep = createStep(
  "propagate-region-to-partners-step",
  async (input: PropagateRegionInput, { container }) => {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(
      ContainerRegistrationKeys.LINK
    ) as any

    const output: PropagateRegionOutput = {
      region_id: input.region_id,
      links_created: 0,
      links_already_existing: 0,
      stores_currency_updated: 0,
      stores_currency_already_current: 0,
      fanout_invocations: 0,
      fanout_created_prices: 0,
      fanout_errors: 0,
      errors: [],
    }

    // 1. Resolve the region.
    const { data: regions } = await query.graph({
      entity: "region",
      filters: { id: input.region_id },
      fields: ["id", "name", "currency_code"],
    })
    const region = regions?.[0] as any
    if (!region) {
      logger.warn(
        `[propagate-region] region ${input.region_id} not found — skipping`
      )
      return new StepResponse(output)
    }
    const regionCurrency = String(region.currency_code).toLowerCase()

    // 2. Resolve target partners.
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "name",
        "stores.id",
        "stores.name",
        "stores.supported_currencies.currency_code",
        "stores.supported_currencies.is_default",
        "stores.default_sales_channel_id",
      ],
    })
    const targetPartners = (partners ?? []).filter(
      (p: any) => !input.partner_ids || input.partner_ids.includes(p.id)
    )
    if (!targetPartners.length) {
      logger.info(
        `[propagate-region] region ${region.id} "${region.name}": no partners to propagate to`
      )
      return new StepResponse(output)
    }

    // 3. Existing partner_region links for this region — used to skip
    //    already-linked pairs.
    const { data: existingLinks } = await query.graph({
      entity: partnerRegionLink.entryPoint,
      filters: { region_id: region.id },
      fields: ["partner_id", "region_id"],
    })
    const linkedPartnerIds = new Set<string>(
      (existingLinks ?? []).map((l: any) => l.partner_id)
    )

    // 4. Pass A — links + supported_currencies. Synchronous, fast.
    for (const partner of targetPartners as any[]) {
      const tag = `partner "${partner.name}" (${partner.id})`

      // Link upsert.
      if (linkedPartnerIds.has(partner.id)) {
        output.links_already_existing++
      } else {
        try {
          await remoteLink.create({
            partner: { partner_id: partner.id },
            [Modules.REGION]: { region_id: region.id },
          })
          linkedPartnerIds.add(partner.id)
          output.links_created++
          logger.info(
            `[propagate-region] ${tag} → region ${region.id} link created`
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : JSON.stringify(err)
          output.errors.push({
            partner_id: partner.id,
            phase: "link",
            error: message,
          })
          logger.error(`[propagate-region] ${tag} link failed: ${message}`)
          continue
        }
      }

      // Currency extension per store.
      for (const store of partner.stores ?? []) {
        const existing = (store.supported_currencies ?? []) as Array<{
          currency_code: string
          is_default?: boolean
        }>
        const has = existing.some(
          (c) => String(c.currency_code).toLowerCase() === regionCurrency
        )
        if (has) {
          output.stores_currency_already_current++
          continue
        }
        const next = [
          ...existing.map((c) => ({
            currency_code: c.currency_code,
            is_default: !!c.is_default,
          })),
          { currency_code: regionCurrency, is_default: false },
        ]
        try {
          await updateStoresWorkflow(container).run({
            input: { selector: { id: store.id }, update: { supported_currencies: next } },
          })
          output.stores_currency_updated++
          logger.info(
            `[propagate-region] ${tag} store "${store.name}" — added ${regionCurrency} to supported_currencies`
          )
        } catch (err) {
          const message = err instanceof Error ? err.message : JSON.stringify(err)
          output.errors.push({
            partner_id: partner.id,
            phase: "currency",
            error: message,
          })
          logger.error(
            `[propagate-region] ${tag} store ${store.id} currency extend failed: ${message}`
          )
        }
      }
    }

    // 5. Pass B (optional) — FX fanout against existing variant prices.
    //    Only useful when the region's currency_code is one the partner's
    //    variants don't already price in. Workflow recursion guard skips
    //    auto-derived sources, so this is safe to call on every price.
    //
    //    Serialized per store (concurrency=1) to avoid the race-condition
    //    pattern we saw in the 0A real run: parallel invocations on the
    //    same variant both load alreadyPriced before either writes, both
    //    try to add the same currency rows, second one errors. Across
    //    stores we go parallel (each partner gets its own runner).
    if (input.trigger_fanout) {
      for (const partner of targetPartners as any[]) {
        for (const store of partner.stores ?? []) {
          const channelId = store?.default_sales_channel_id
          if (!channelId) continue

          // Walk variants via sales_channel → products_link → product →
          // variants — same pattern as fanout-existing-variant-prices.ts.
          const { data: scData } = await query.graph({
            entity: "sales_channel",
            filters: { id: channelId },
            fields: [
              "products_link.product.variants.price_set.prices.id",
            ],
          })
          const links = ((scData?.[0] as any)?.products_link ?? []) as Array<{
            product?: {
              variants?: Array<{
                price_set?: { prices?: Array<{ id?: string }> }
              }>
            }
          }>

          for (const link of links) {
            for (const variant of link?.product?.variants ?? []) {
              for (const price of variant?.price_set?.prices ?? []) {
                if (!price?.id) continue
                output.fanout_invocations++
                try {
                  const { result } = await fanoutPricesWorkflow(container).run({
                    input: { source_price_id: price.id, store_id: store.id },
                  })
                  output.fanout_created_prices += result?.created_count ?? 0
                  if (result?.errors?.length) {
                    output.fanout_errors += result.errors.length
                  }
                } catch (err) {
                  const message =
                    err instanceof Error ? err.message : JSON.stringify(err)
                  output.fanout_errors++
                  output.errors.push({
                    partner_id: partner.id,
                    phase: "fanout",
                    error: `price=${price.id}: ${message}`,
                  })
                  logger.warn(
                    `[propagate-region] fanout price ${price.id} failed: ${message}`
                  )
                }
              }
            }
          }
        }
      }
    }

    logger.info(
      `[propagate-region] region ${region.id} "${region.name}" (${regionCurrency}) complete. ` +
        `links_created=${output.links_created}, ` +
        `links_already=${output.links_already_existing}, ` +
        `stores_currency_updated=${output.stores_currency_updated}, ` +
        `stores_currency_already=${output.stores_currency_already_current}, ` +
        `fanout_invocations=${output.fanout_invocations}, ` +
        `fanout_created_prices=${output.fanout_created_prices}, ` +
        `fanout_errors=${output.fanout_errors}, ` +
        `errors=${output.errors.length}`
    )

    return new StepResponse(output)
  }
)

export const propagateRegionToPartnersWorkflow = createWorkflow(
  "propagate-region-to-partners",
  (input: PropagateRegionInput) => {
    const summary = propagateStep(input)
    return new WorkflowResponse(summary)
  }
)

export default propagateRegionToPartnersWorkflow
