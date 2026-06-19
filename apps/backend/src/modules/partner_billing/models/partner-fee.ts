import { model } from "@medusajs/framework/utils"

/**
 * partner_fee — one accrued platform commission per partner per order (#336).
 *
 * The platform's cut (default 2% — `PLATFORM_TX_FEE_BPS=200`) of an order the
 * partner fulfils. This is a COMMISSION deducted from the partner's payout, NOT
 * a customer-facing charge and NOT a tax (do not use the Medusa tax module).
 *
 * Accrued at `order.placed` for partner-linked orders only; reversed on cancel.
 * All money fields are `bigNumber` (Medusa money convention) in the order's
 * currency — never grab `stores[0]` for currency post-#485.
 */
const PartnerFee = model.define("partner_fee", {
  id: model.id().primaryKey(),
  // The partner who owes the commission (resolved via the partner↔order link).
  partner_id: model.text(),
  // The order this fee was accrued for. One accrued fee per order (idempotency key).
  order_id: model.text(),
  // Snapshot of the order total the fee was computed from, in `currency_code`.
  order_total: model.bigNumber(),
  currency_code: model.text(),
  // How `fee_rate` is interpreted: percentage (basis points) or a flat amount.
  fee_basis: model.enum(["percentage", "flat"]).default("percentage"),
  // For percentage: basis points (200 = 2.00%). For flat: an amount in currency_code.
  fee_rate: model.number(),
  // The computed commission amount, in `currency_code`.
  fee_amount: model.bigNumber(),
  // Lifecycle: accrued at placement → invoiced when billed → waived/reversed on cancel.
  status: model
    .enum(["accrued", "invoiced", "waived", "reversed"])
    .default("accrued"),
  accrued_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default PartnerFee
