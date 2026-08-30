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

  /**
   * #1596 — SHORT CLOSE. A run ordered for 9 and completed at 7 keeps 2 units
   * billable, because ordered-quantity headroom cannot tell "not made yet"
   * from "never will be made". This is the statement that settles it: from
   * here the billable ceiling is what was PRODUCED, not what was ordered.
   *
   * Typed columns rather than metadata: this decides how much money a partner
   * may still claim, and a metadata blob is not a contract (#1557).
   *
   * `short_closed_by` is an admin actor id, or the literal "system" when the
   * 30-day counter closed it. `short_closed_quantity` records what produced
   * was BELIEVED to be at the moment of closing — the ceiling itself is always
   * re-derived from the live `produced_quantity`, so a later upward correction
   * is honoured rather than frozen out.
   */
  short_closed_at: model.dateTime().nullable(),
  short_closed_by: model.text().nullable(),
  short_close_reason: model.text().nullable(),
  short_closed_quantity: model.float().nullable(),

  // Cost
  partner_cost_estimate: model.float().nullable(),
  cost_type: model.enum(["per_unit", "total"]).default("total").nullable(),

  // Dispatch state
  dispatch_state: model
    .enum(["idle", "awaiting_templates", "completed"])
    .default("idle"),
  dispatch_started_at: model.dateTime().nullable(),
  dispatch_completed_at: model.dateTime().nullable(),
  /**
   * INTENT, recorded at APPROVAL — the names an approver said the run should be
   * dispatched with. Written only by `approve-production-run`, and only when the
   * assignment named templates; a run whose templates are chosen later at
   * dispatch time keeps this null forever. It is NOT evidence of what ran.
   */
  dispatch_template_names: model.json().nullable(),
  /**
   * The same INTENT, said properly (#1268). `dispatch_template_names` records a
   * label, and a label is not an identity: two templates can share one (#1261),
   * in which case dispatch refuses the name outright and the approval it came
   * from can no longer be carried out. Ids survive the
   * `deduplicate-task-template-names` job renaming a row, too.
   *
   * Preferred over the names wherever both are present. Still INTENT — what an
   * approver asked for, not what happened; `dispatched_template_ids` is the
   * record of what actually went out.
   */
  dispatch_template_ids: model.json().nullable(),
  /**
   * RECORD, written when the run is actually dispatched — the ids of the task
   * templates that were resolved and instantiated. Written by
   * `send-production-run-to-production`, which every dispatch path goes through.
   *
   * IDS, not names, deliberately: a name is not an identity (#1261 — prod had
   * two `Stitching` rows differing only by category), and names are renameable,
   * as the `deduplicate-task-template-names` job does. An id still answers
   * "which process did this run actually follow?" after a rename.
   *
   * Before this existed the only evidence was the tasks themselves, so template
   * recovery had to do archaeology on them and lost the answer entirely if they
   * were deleted.
   */
  dispatched_template_ids: model.json().nullable(),

  snapshot: model.json(),
  captured_at: model.dateTime(),
  depends_on_run_ids: model.json().nullable(),

  /**
   * Stage-0 dependencies that are NOT production runs (#1529).
   *
   * A chain often starts with someone SUPPLYING rather than making: a weaver
   * receives an inventory order, and the designer who works that cloth cannot
   * begin until it is physically with them. That edge could not be expressed
   * before — `depends_on_run_ids` only ever points at production runs — so the
   * supplying stage sat outside the graph entirely and the stage after it had
   * to be released by hand.
   *
   * Held to the same rule as the run edge and deliberately the STRICTER reading
   * of it: an inventory order counts as met at `Delivered`, not at `Shipped`.
   * `Shipped` only says the goods left the supplier; the partner downstream
   * needs them in hand, and releasing a stage whose materials are still in
   * transit makes a run look startable when nothing can be started.
   */
  depends_on_inventory_order_ids: model.json().nullable(),

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

  // #1228 — how many times the reminder cap has re-nudged the SAME partner
  // instead of parking the run. Budget comes from the stored policy
  // (`reassignment.same_partner_retries`, default 1). Once spent, the next cap
  // parks the run in awaiting_reassignment as before. Reset to 0 whenever a
  // partner is (re)assigned, so each partner gets its own budget.
  reassign_retry_count: model.number().default(0),

  metadata: model.json().nullable(),
})

export default ProductionRun
