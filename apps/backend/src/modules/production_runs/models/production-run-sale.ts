import { model } from "@medusajs/framework/utils"

/**
 * #2322 — a sale the partner made of pieces from a run they produced on OUR
 * material. One row per reported sale (or batch of sales at one price).
 *
 * The money owed to us is computed from these rows × the run's
 * `profit_share_percent`; it is never stored, so a corrected sale corrects the
 * amount owed. Columns, not metadata: these rows decide money (#2322 notes).
 *
 * `production_run_id` is flat text, like the activity table, so the run row
 * does not grow a generated reverse relation.
 */
const ProductionRunSale = model.define("production_run_sale", {
  id: model.id({ prefix: "prun_sale" }).primaryKey(),

  production_run_id: model.text().searchable(),
  partner_id: model.text().nullable(),

  /** Pieces sold in this line. > 0. */
  quantity: model.float(),
  /** Gross price of ONE piece, before any of the partner's costs or fees. */
  unit_price: model.bigNumber(),
  /** Lowercase 3-letter code, e.g. "inr". */
  currency_code: model.text().default("inr"),
  sold_at: model.dateTime(),

  note: model.text().nullable(),
  reported_by: model.enum(["admin", "partner"]).default("admin"),
  actor_id: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default ProductionRunSale
