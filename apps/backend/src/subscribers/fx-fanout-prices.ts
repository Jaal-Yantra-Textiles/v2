import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import {
  fanoutVariantPrices,
  FX_FANOUT_REQUESTED,
  type FxFanoutRequestedPayload,
} from "../workflows/fx/fanout-variant-prices"

/**
 * FX price fanout, moved off the request path.
 *
 * Partner/admin routes that write variant prices now emit
 * `fx.fanout_requested` (see requestVariantPriceFanout) instead of running the
 * fanout inline. This handler does the work — and because subscribers only run
 * in WORKER mode, the work lands on the background service rather than in the
 * public API container.
 *
 * That placement is the point. The fanout runs one full workflow-engine
 * execution per price; doing that inside a request meant a partner saving a
 * multi-variant product could allocate hundreds of megabytes in the container
 * that also serves the storefront. On 2026-08-19 it OOM-killed prod twice
 * (exit 137, 11:38 and 23:42 UTC) — memory 57% → 99% of a 2 GB task inside one
 * minute, event loop blocked so hard the process stopped logging for 65s.
 * Here, the same overload costs a worker restart and a retry, not a 503.
 *
 * The fanout itself stays bounded (FANOUT_MAX_CONCURRENCY) — moving work to a
 * 1 GB worker only helps if the work has a ceiling. Both halves are required.
 *
 * Idempotent by construction: the workflow's `fx_price_meta` recursion guard
 * skips prices that fanout already derived, and its "already priced" check
 * skips currencies the price_set already carries. A redelivered event is a
 * no-op, so at-least-once delivery is safe.
 */
export default async function fxFanoutPricesHandler({
  event: { data },
  container,
}: SubscriberArgs<FxFanoutRequestedPayload>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as any

  if (!data?.store_id) return
  if (!data.price_ids?.length && !data.variant_ids?.length) return

  // fanoutVariantPrices never throws — it logs and returns a result. The
  // try/catch is for the resolve/plumbing around it, so a bad event can never
  // take the subscriber (and with it the worker) down.
  try {
    const result = await fanoutVariantPrices(container, {
      storeId: data.store_id,
      ...(data.price_ids?.length ? { priceIds: data.price_ids } : {}),
      ...(data.variant_ids?.length ? { variantIds: data.variant_ids } : {}),
    })
    logger?.info?.(
      `[fanout] store ${data.store_id}: ${result.price_ids.length} price(s) processed, ` +
        `${result.created_count} auto-price(s) created, ${result.failed_count} failed`
    )
  } catch (e: any) {
    logger?.warn?.(
      `[fanout] handler failed for store ${data.store_id}: ${e?.message ?? e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: FX_FANOUT_REQUESTED,
}
