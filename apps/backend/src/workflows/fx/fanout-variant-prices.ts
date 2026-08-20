import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

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
 * How many `fanoutPricesWorkflow` runs may be in flight at once.
 *
 * This is a MEMORY bound, not a throughput tuning knob. Each run is a full
 * workflow-engine execution (own context, steps, Redis-persisted state, DB
 * work), so the peak footprint of a fanout is `concurrency × per-run cost`,
 * NOT `per-run cost`. Before this was bounded the helper launched one run per
 * price simultaneously — a partner saving a multi-variant product across a
 * multi-currency store fanned out into hundreds of concurrent workflow runs.
 *
 * That is what OOM-killed the prod API container twice on 2026-08-19 (11:38
 * and 23:42 UTC, exit 137): memory went 57% → 99% of a 2 GB task inside ONE
 * minute, with the event loop blocked long enough to stop logging for 65s.
 * Both kills came through this helper — once via `create_product`, once via
 * `variants/batch`.
 *
 * The old code claimed "bounded concurrency via Promise.allSettled" in this
 * very docblock. `Promise.allSettled` bounds NOTHING; it waits on whatever it
 * is handed, all of which starts immediately. The comment described the
 * intent and hid the defect for as long as it stood.
 */
export const FANOUT_MAX_CONCURRENCY = 4

/**
 * Run `task` over `items` with at most `limit` in flight at a time.
 *
 * A fixed pool of workers pulling from a shared cursor, rather than
 * fixed-size batches: a slow price never idles the other workers waiting for
 * its batch to drain. Each task is expected to swallow its own errors — this
 * runner never rejects.
 */
export async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor++]
        await task(item)
      }
    }
  )
  await Promise.all(workers)
}

/**
 * Fire-and-forget FX fanout for freshly written variant prices. Resolves the
 * target price ids from `priceIds` (preferred) or by looking them up from
 * `variantIds`, then runs `fanoutPricesWorkflow` once per price, at most
 * FANOUT_MAX_CONCURRENCY at a time. Never throws — the worst case is a logged
 * warning and no auto-prices, exactly the pre-existing behaviour.
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

    await mapWithConcurrency(
      priceIds,
      FANOUT_MAX_CONCURRENCY,
      async (priceId) => {
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
      }
    )
  } catch (err) {
    // Resolving the query graph / anything above must never break the save.
    const message = err instanceof Error ? err.message : String(err)
    logger.warn(`[fanout] variant-price fanout aborted: ${message}`)
  }

  return result
}

export default fanoutVariantPrices

/**
 * Event that asks for an FX fanout to be performed off the request path.
 * Handled by src/subscribers/fx-fanout-prices.ts, which runs on the WORKER.
 */
export const FX_FANOUT_REQUESTED = "fx.fanout_requested"

export type FxFanoutRequestedPayload = {
  store_id: string
  price_ids?: string[]
  variant_ids?: string[]
}

/**
 * ASYNC entry point — what routes should call.
 *
 * Emits FX_FANOUT_REQUESTED and returns immediately; the actual fanout runs in
 * the worker's subscriber. Three reasons this is not just a perf nicety:
 *
 *  1. MEMORY. The fanout's peak footprint is `concurrency × workflow-run cost`.
 *     Running it inline put that peak inside the public API container, which is
 *     the one that gets OOM-killed and takes the storefront down with it (twice
 *     on 2026-08-19). The worker can die and retry without a single 503.
 *  2. LATENCY. The partner's save used to block on every price's workflow run.
 *  3. DURABILITY. Inline, a fanout interrupted mid-flight (deploy, OOM, client
 *     disconnect) left prices half-materialised with nothing to resume it.
 *
 * Never throws. If the event bus itself is unreachable the fanout is skipped
 * and logged — exactly the pre-existing "worst case is no auto-prices"
 * contract, and never a failed save for the partner.
 */
export async function requestVariantPriceFanout(
  scope: any,
  input: FanoutVariantPricesInput
): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  const payload: FxFanoutRequestedPayload = {
    store_id: input.storeId,
    ...(input.priceIds?.length ? { price_ids: input.priceIds } : {}),
    ...(input.variantIds?.length ? { variant_ids: input.variantIds } : {}),
  }

  // Nothing to fan out — don't wake the worker for an empty job.
  if (!payload.price_ids?.length && !payload.variant_ids?.length) return

  try {
    const eventBus: any = scope.resolve(Modules.EVENT_BUS)
    await eventBus.emit({ name: FX_FANOUT_REQUESTED, data: payload })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger?.warn?.(
      `[fanout] could not enqueue FX fanout for store ${input.storeId}: ${message}`
    )
  }
}
