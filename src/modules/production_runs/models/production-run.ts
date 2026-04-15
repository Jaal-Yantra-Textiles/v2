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
  cancelled_at: model.dateTime().nullable(),
  cancelled_reason: model.text().translatable().nullable(),

  // Stage notes (captured at each milestone by partner)
  finish_notes: model.text().translatable().nullable(),
  completion_notes: model.text().translatable().nullable(),

  // Output / yield (captured at completion by partner)
  produced_quantity: model.float().nullable(),
  rejected_quantity: model.float().nullable(),
  rejection_reason: model.text().translatable().nullable(),
  rejection_notes: model.text().translatable().nullable(),

  // Cost
  partner_cost_estimate: model.float().nullable(),
  cost_type: model.enum(["per_unit", "total"]).default("total").nullable(),

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

  // Lifecycle workflow transaction ID — used to signal async steps
  lifecycle_transaction_id: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default ProductionRun
