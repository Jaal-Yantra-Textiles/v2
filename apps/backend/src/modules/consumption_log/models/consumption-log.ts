import { model } from "@medusajs/framework/utils"

const ConsumptionLog = model.define("consumption_log", {
  id: model.id().primaryKey(),
  /**
   * What was being made. NULLABLE since #938-groundwork: a product-only
   * production run — one minted from `order.fulfillment_created` for a product
   * with no backing design (#1112) — consumes real material, and until now had
   * nowhere to record it. `design_id text not null` asserted that every
   * consumption traces to a design, which stopped being true the day
   * product-only runs shipped.
   *
   * 🔴 `design_id` and `product_id` are BOTH nullable but not both absent: a
   * CHECK constraint requires at least one. That mirrors the production run
   * itself, which carries the same pair and branches on presence — and it
   * matches the data, where all 122 runs on prod have at least one of the two
   * (110 design-only, 8 product-only, 4 both, 0 neither).
   *
   * Do NOT collapse these into "just use product": product covers 12 of those
   * 122 runs today. It becomes universal only once #938 Phase 0 backs every
   * design with a product at birth, and that has not landed.
   */
  design_id: model.text().nullable(),
  product_id: model.text().nullable(),
  variant_id: model.text().nullable(),
  production_run_id: model.text().nullable(),
  inventory_item_id: model.text().nullable(),
  raw_material_id: model.text().nullable(),
  quantity: model.float(),
  /**
   * What `quantity` measures. NULLABLE on purpose: rows written before the
   * capture forms asked the question have an unknowable basis, and guessing one
   * would silently mis-scale both cost and stock. Consumers must resolve a null
   * basis explicitly rather than defaulting it.
   */
  quantity_basis: model.enum(["total", "per_piece"]).nullable(),
  unit_cost: model.float().nullable(),
  unit_of_measure: model
    .enum([
      "Meter",
      "Yard",
      "Kilogram",
      "Gram",
      "Piece",
      "Roll",
      "kWh",
      "Liter",
      "Cubic_Meter",
      "Hour",
      "Other",
    ])
    .default("Other"),
  consumption_type: model
    .enum([
      "sample",
      "production",
      "wastage",
      "energy_electricity",
      "energy_water",
      "energy_gas",
      "labor",
    ])
    .default("sample"),
  is_committed: model.boolean().default(false),
  consumed_by: model.enum(["admin", "partner"]).default("admin"),
  consumed_at: model.dateTime(),
  notes: model.text().nullable(),
  location_id: model.text().nullable(),
  /**
   * When this log's stock deduction was applied, and to which location.
   *
   * 🔴 Real columns, not metadata keys, because `inventory_applied_at` is the
   * ONLY thing standing between a re-run of the apply job and double-deducting
   * inventory. As a key inside the `metadata` JSON blob it survived purely by
   * every writer remembering to spread the existing object — a convention, not
   * a constraint. One `metadata: body.metadata` on an update route would have
   * erased the guard silently, and the next apply run would have taken the
   * stock a second time with nothing failing loudly.
   *
   * Legacy rows carry the values under `metadata.inventory_applied_at` /
   * `metadata.inventory_applied_location_id`; readers fall back to those until
   * `backfill-consumption-applied-columns` has swept them.
   */
  inventory_applied_at: model.dateTime().nullable(),
  inventory_applied_location_id: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default ConsumptionLog
