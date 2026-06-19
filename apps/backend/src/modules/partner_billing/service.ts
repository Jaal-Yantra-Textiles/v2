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
}

export default PartnerBillingService
