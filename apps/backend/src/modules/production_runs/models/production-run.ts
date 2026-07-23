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
      // #1093 — a run whose assigned partner never accepted (2 reminders sent,
      // then capped) or who declined. Partner is unassigned; the run waits in
      // the admin reassignment queue for a new partner (re-dispatch reuses
      // dispatch-production-run). Distinct from cancelled: the work still needs
      // doing, just by someone else.
      "awaiting_reassignment",
    ])
    .default("pending_review"),
  run_type: model.enum(["production", "sample"]).default("production"),
  quantity: model.float().default(1),

  parent_run_id: model.text().nullable(),
  role: model.text().nullable(),

  // #1112 — nullable so a retail-fulfillment provenance run can be minted for a
  // product with NO backing design (product-only path). Design work-orders still
  // set it; the create workflow branches on its presence.
  design_id: model.text().nullable(),
  partner_id: model.text().nullable(),

  // Roadmap #6 Phase 4 — how the run is executed:
  //   in_house   = the owning partner manufactures it themselves
  //   outsourced = handed to another partner/vendor (sub_partner_id)
  // Lets partner cost tracking isolate self-made vs farmed-out work.
  execution_mode: model.enum(["in_house", "outsourced"]).default("in_house"),
  // The downstream partner a run is outsourced to (null for in_house).
  sub_partner_id: model.text().nullable(),

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

  // #1093 — actionable-reminder state machine.
  //   reminder_count   how many reminders have been SENT in the current cycle
  //                    (a "cycle" = a single reminder_kind bucket). Capped at 2;
  //                    the 2nd warns of reassignment, then the run escalates.
  //   reminder_kind    the bucket the count belongs to (assignment_pending /
  //                    not_started / idle). When the run moves to a new bucket
  //                    the count resets so each stage gets its own 2 reminders.
  //   last_reminded_at timestamp of the most recent reminder send.
  //   reminder_status  cycle lifecycle: "active" (reminding), "escalated" (cap
  //                    hit on an already-accepted run → admin notified, no
  //                    reassignment), "closed" (partner acted / run left the
  //                    bucket). null = never reminded. assignment_pending caps
  //                    move the RUN status to awaiting_reassignment instead.
  reminder_count: model.number().default(0),
  reminder_kind: model.text().nullable(),
  last_reminded_at: model.dateTime().nullable(),
  reminder_status: model
    .enum(["active", "escalated", "closed"])
    .nullable(),

  // #1093 — the partner a run was unassigned FROM when it entered
  // awaiting_reassignment (reminder cap or decline). Audit-only; re-dispatch
  // assigns a fresh partner_id.
  previous_partner_id: model.text().nullable(),

  metadata: model.json().nullable(),
})

export default ProductionRun
