import { model } from "@medusajs/framework/utils"

const ProductionRunPolicy = model.define("production_run_policies", {
  id: model.id({ prefix: "prod_pol" }).primaryKey(),
  key: model.text().unique(),
  config: model.json().nullable(),
  metadata: model.json().nullable(),
})

export default ProductionRunPolicy
