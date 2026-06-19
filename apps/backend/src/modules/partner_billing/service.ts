import { MedusaService } from "@medusajs/framework/utils"
import PartnerFee from "./models/partner-fee"

/**
 * partner_billing — accrues platform commission fees per partner per order (#336).
 *
 * MedusaService auto-generates createPartnerFees / listPartnerFees /
 * listAndCountPartnerFees / retrievePartnerFee / updatePartnerFees /
 * deletePartnerFees for the PartnerFee model.
 */
class PartnerBillingService extends MedusaService({
  PartnerFee,
}) {
  /**
   * The existing accrued fee for an order, if any. Used for idempotency by the
   * accrual subscriber (Slice 2) — `order.placed` can re-fire.
   */
  async findFeeForOrder(orderId: string) {
    const fees = await this.listPartnerFees({ order_id: orderId })
    return fees?.[0] || null
  }

  /**
   * Reverse the accrued commission for an order (Slice 3 — compensation on
   * `order.canceled`). Idempotent and best-effort:
   *   - no fee for the order (retail / never accrued) → returns null, no-op
   *   - fee already in a terminal/billed state (reversed | waived | invoiced)
   *     → returns null, leaves it untouched (don't silently undo a billed fee)
   *   - fee is `accrued` → flips it to `reversed`, stamps the reason/time in
   *     metadata, and returns the updated row.
   * Returning null when nothing changed lets the caller log only real reversals.
   */
  async reverseFeeForOrder(orderId: string, reason = "order.canceled") {
    const fee = await this.findFeeForOrder(orderId)
    if (!fee) {
      return null
    }
    if (fee.status !== "accrued") {
      return null
    }
    const [updated] = await this.updatePartnerFees([
      {
        id: fee.id,
        status: "reversed",
        metadata: {
          ...(fee.metadata || {}),
          reversed_at: new Date().toISOString(),
          reversed_reason: reason,
        },
      },
    ])
    return updated
  }
}

export default PartnerBillingService
