import { model } from "@medusajs/framework/utils"

/**
 * #2322 — money the partner PAID US against a profit-share run. The reverse of
 * a payout: recorded, not collected (founder decision 2026-10-03 — bank
 * transfer or cash). Partial payments are ordinary; the balance stays open.
 */
const ProductionRunSettlement = model.define("production_run_settlement", {
  id: model.id({ prefix: "prun_stl" }).primaryKey(),

  production_run_id: model.text().searchable(),
  partner_id: model.text().nullable(),

  amount: model.bigNumber(),
  currency_code: model.text().default("inr"),
  method: model.enum(["bank_transfer", "cash"]),
  paid_at: model.dateTime(),
  /** UTR for a bank transfer; the person who took it for cash. */
  reference: model.text().nullable(),
  receipt_url: model.text().nullable(),
  note: model.text().nullable(),
  actor_id: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default ProductionRunSettlement
