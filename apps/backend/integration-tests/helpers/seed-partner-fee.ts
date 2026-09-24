import { Modules } from "@medusajs/framework/utils"
import { PARTNER_BILLING_MODULE } from "../../src/modules/partner_billing"
import { computeFee } from "../../src/modules/partner_billing/compute-fee"

/**
 * Seed one accrued 2% `commission` partner_fee for an order — the row the
 * order.placed subscriber USED to write for a partner-linked (work) order.
 *
 * 2026-09-24 (#2262, founder decision A): work orders carry NO commission, so
 * the subscriber no longer writes this row. Specs that test what happens to a
 * fee AFTER it exists (reversal on cancel, the fee read APIs) seed it directly
 * instead of relying on the subscriber.
 */
export const seedCommissionFee = async (
  container: any,
  partnerId: string,
  orderId: string
) => {
  const order: any = await container
    .resolve(Modules.ORDER)
    .retrieveOrder(orderId, { select: ["id", "total", "currency_code"] })
  const total = Number(order.total)
  const [fee] = await container.resolve(PARTNER_BILLING_MODULE).createPartnerFees([
    {
      partner_id: partnerId,
      order_id: orderId,
      order_total: Number.isFinite(total) ? total : 0,
      currency_code: order.currency_code || "",
      fee_basis: "percentage",
      fee_rate: 200,
      fee_amount: computeFee(total, "percentage", 200),
      fee_type: "commission",
      status: "accrued",
      accrued_at: new Date(),
      metadata: { source: "test.seed" },
    },
  ])
  return fee
}
