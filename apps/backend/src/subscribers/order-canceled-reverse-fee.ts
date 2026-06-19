import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { PARTNER_BILLING_MODULE } from "../modules/partner_billing"

/**
 * #336 Slice 3 — partner transaction-fee reversal (compensation).
 *
 * Sibling subscriber on `order.canceled` (kept separate from `order-canceled.ts`
 * so fee reversal can never break the partner cancellation notification, and
 * vice-versa). When a partner-linked order that accrued a commission at
 * `order.placed` is cancelled, the accrued `partner_fee` is flipped to
 * `reversed` so the partner is no longer billed for it.
 *
 * GATING / IDEMPOTENCY — all of it lives in `reverseFeeForOrder`:
 *   - retail orders (no accrued fee) → no-op (`findFeeForOrder` returns null);
 *   - a double-fired `order.canceled` → the second pass sees status `reversed`
 *     (not `accrued`) and is a no-op;
 *   - an already `invoiced`/`waived` fee is left untouched (don't silently undo
 *     a billed fee).
 *
 * Best-effort: any failure is logged and swallowed — reversal must never throw
 * out of the cancellation event.
 */
export default async function orderCanceledReverseFeeHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  try {
    const billingService: any = container.resolve(PARTNER_BILLING_MODULE)
    const reversed = await billingService.reverseFeeForOrder(
      data.id,
      "order.canceled"
    )
    if (reversed) {
      logger.info(
        `[order.canceled] Reversed partner fee ${reversed.fee_amount} ${reversed.currency_code} for partner ${reversed.partner_id} on order ${data.id}`
      )
    }
  } catch (e: any) {
    logger.warn(
      `[order.canceled] Partner fee reversal failed for order ${data.id}: ${
        e?.message || e
      }`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
