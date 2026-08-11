import { model } from "@medusajs/framework/utils"

const ConsumptionLog = model.define("consumption_log", {
  id: model.id().primaryKey(),
  design_id: model.text(),
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
  metadata: model.json().nullable(),
})

export default ConsumptionLog
