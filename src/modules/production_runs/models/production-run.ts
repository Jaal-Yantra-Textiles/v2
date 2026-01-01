import { model } from "@medusajs/framework/utils"

const ProductionRun = model.define("production_runs", {
  id: model.id({ prefix: "prod_run" }).primaryKey(),
  status: model
    .enum([
      "draft",
      "pending_review",
      "approved",
      "sent_to_partner",
      "in_progress",
      "completed",
      "cancelled",
    ])
    .default("pending_review"),
  quantity: model.float().default(1),

  design_id: model.text(),
  partner_id: model.text().nullable(),

  product_id: model.text().nullable(),
  variant_id: model.text().nullable(),
  order_id: model.text().nullable(),
  order_line_item_id: model.text().nullable(),

  snapshot: model.json(),
  captured_at: model.dateTime(),
  metadata: model.json().nullable(),
})

export default ProductionRun
