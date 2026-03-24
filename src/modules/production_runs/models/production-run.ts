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
  run_type: model.enum(["production", "sample"]).default("production"),
  quantity: model.float().default(1),

  parent_run_id: model.text().nullable(),
  role: model.text().nullable(),

  design_id: model.text(),
  partner_id: model.text().nullable(),

  product_id: model.text().nullable(),
  variant_id: model.text().nullable(),
  order_id: model.text().nullable(),
  order_line_item_id: model.text().nullable(),

  // Lifecycle timestamps
  accepted_at: model.dateTime().nullable(),
  started_at: model.dateTime().nullable(),
  finished_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),

  // Dispatch state
  dispatch_state: model
    .enum(["idle", "awaiting_templates", "completed"])
    .default("idle"),
  dispatch_started_at: model.dateTime().nullable(),
  dispatch_completed_at: model.dateTime().nullable(),
  dispatch_template_names: model.json().nullable(),

  snapshot: model.json(),
  captured_at: model.dateTime(),
  depends_on_run_ids: model.json().nullable(),
  metadata: model.json().nullable(),
})

export default ProductionRun
