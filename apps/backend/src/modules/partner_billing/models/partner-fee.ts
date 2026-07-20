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
  // For a `retail_split` fee this is the COMBINED rate (gateway + commission bps).
  fee_rate: model.number(),
  // The computed fee amount, in `currency_code`. For `retail_split` this is the
  // TOTAL (payment_gateway_amount + commission_amount).
  fee_amount: model.bigNumber(),
  // Fee shape: `commission` is the legacy single-rate platform commission
  // (partner work-orders, default 2%). `retail_split` is the partner retail
  // order fee = payment gateway + commission (default 2% + 15%), whose two
  // components are itemised in the columns below.
  fee_type: model.enum(["commission", "retail_split"]).default("commission"),
  // --- retail_split breakdown (null for legacy `commission` rows) ------------
  // Payment-gateway component: rate (bps, 200 = 2.00%) + computed amount.
  payment_gateway_bps: model.number().nullable(),
  payment_gateway_amount: model.bigNumber().nullable(),
  // Platform-commission component: rate (bps, 1500 = 15.00%) + computed amount.
  commission_bps: model.number().nullable(),
  commission_amount: model.bigNumber().nullable(),
  // Lifecycle: accrued at placement → invoiced when billed → waived/reversed on cancel.
  status: model
    .enum(["accrued", "invoiced", "waived", "reversed"])
    .default("accrued"),
  accrued_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default PartnerFee
