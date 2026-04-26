import { model } from "@medusajs/framework/utils"

const EnergyRate = model.define("energy_rate", {
  id: model.id().primaryKey(),
  name: model.text().searchable(),
  energy_type: model
    .enum([
      "energy_electricity",
      "energy_water",
      "energy_gas",
      "labor",
    ]),
  unit_of_measure: model
    .enum(["kWh", "Liter", "Cubic_Meter", "Hour", "Other"])
    .default("Other"),
  rate_per_unit: model.float(),
  currency: model.text().default("inr"),
  effective_from: model.dateTime(),
  effective_to: model.dateTime().nullable(),
  region: model.text().nullable(),
  is_active: model.boolean().default(true),
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default EnergyRate
