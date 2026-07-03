import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import fanoutPricesWorkflow from "./fanout-prices"

/**
 * Shared FX fanout trigger for partner routes that write variant prices.
 *
 * Medusa's pricing module doesn't emit a `price.created` event we can
 * subscribe to (verified — see the batch route + FX_AUTO_CONVERSION.md),
 * so every route that creates or updates a variant price has to kick off
 * `fanoutPricesWorkflow` itself. Historically only the `variants/batch`
 * route did, so products created through the create-product / quick-create
 * / single-variant / discover-copy paths never materialised auto-converted
 * prices in the store's other supported currencies — leaving them
 * "not available" in every non-native region.
 *
 * This helper centralises that trigger so all paths behave identically:
 *   - idempotent (the workflow's `fx_price_meta` recursion guard skips
 *     auto-derived source prices; its "already priced" check skips
 *     currencies that already exist on the price_set),
 *   - fire-and-forget with per-price errors logged + swallowed so a
 *     failing fanout never tanks the partner's save,
 *   - NEVER throws.
 */

/**
 * PURE: pull every price id off a list of variant objects, tolerating both
 * shapes we get back from core-flows / query.graph:
 *   - `variant.prices[]`            (remapped partner responses)
 *   - `variant.price_set.prices[]`  (raw query.graph / core-flow output)
 * Ignores auto-derived rows here is NOT this fn's job — the workflow's
 * recursion guard handles that per-price.
 */
export function collectVariantPriceIds(
  variants: Array<any> | undefined | null
): string[] {
  const ids: string[] = []
  for (const v of variants ?? []) {
    const prices = v?.prices ?? v?.price_set?.prices ?? []
    for (const p of prices) {
      if (p?.id) ids.push(String(p.id))
    }
  }
  return ids
}

export type FanoutVariantPricesInput = {
  /** Store whose supported_currencies drive the fanout. */
  storeId: string
  /** Price ids to fan out. Pass this when you already have the prices inline. */
  priceIds?: string[]
  /**
   * Variant ids whose price rows should be fanned out. When `priceIds` isn't
   * given, the helper resolves them via query.graph (`product_variants →
   * price_set.prices.id`). Use this from routes that only hold the created /
   * updated variant ids after a workflow run.
   */
  variantIds?: string[]
}

export type FanoutVariantPricesResult = {
  price_ids: string[]
  created_count: number
  failed_count: number
}

/**
 * Fire-and-forget FX fanout for freshly written variant prices. Resolves the
 * target price ids from `priceIds` (preferred) or by looking them up from
 * `variantIds`, then runs `fanoutPricesWorkflow` once per price with bounded
 * concurrency via Promise.allSettled. Never throws — the worst case is a
 * logged warning and no auto-prices, exactly the pre-existing behaviour.
 */
export async function fanoutVariantPrices(
  scope: any,
  input: FanoutVariantPricesInput
): Promise<FanoutVariantPricesResult> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const result: FanoutVariantPricesResult = {
    price_ids: [],
    created_count: 0,
    failed_count: 0,
  }

  try {
    let priceIds = input.priceIds ?? []

    if (!priceIds.length && input.variantIds?.length) {
      const query: any = scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data } = await query.graph({
        entity: "product_variants",
        fields: ["id", "price_set.prices.id"],
        filters: { id: input.variantIds },
      })
      priceIds = collectVariantPriceIds(data)
    }

    // de-dupe defensively — the same price id could arrive twice if a caller
    // passes overlapping created/updated sets.
    priceIds = Array.from(new Set(priceIds.filter(Boolean)))
    result.price_ids = priceIds

    if (!priceIds.length) return result

    await Promise.allSettled(
      priceIds.map(async (priceId) => {
        try {
          const { result: fanoutResult } = await fanoutPricesWorkflow(scope).run({
            input: { source_price_id: priceId, store_id: input.storeId },
          })
          if (fanoutResult?.skipped_reason) {
            logger.info(
              `[fanout] price ${priceId} skipped: ${fanoutResult.skipped_reason}`
            )
          } else if (fanoutResult?.created_count) {
            result.created_count += fanoutResult.created_count
            logger.info(
              `[fanout] price ${priceId} created ${fanoutResult.created_count} auto-prices`
            )
          }
        } catch (err) {
          result.failed_count++
          const message = err instanceof Error ? err.message : String(err)
          logger.warn(`[fanout] price ${priceId} workflow failed: ${message}`)
        }
      })
    )
  } catch (err) {
    // Resolving the query graph / anything above must never break the save.
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[fanout] variant-price fanout aborted: ${message}`)
  }

  return result
}

export default fanoutVariantPrices
