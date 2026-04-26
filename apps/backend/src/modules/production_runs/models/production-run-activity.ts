import { model } from "@medusajs/framework/utils"

/**
 * First-class activity log row attached to a production run.
 *
 * Captures discrete events on a run — lifecycle transitions (sent_to_partner,
 * accepted, started, …), reminder dispatches (assignment_pending, idle, …),
 * future note/comment types — so the run timeline can be rendered without
 * stuffing arrays into `production_run.metadata`.
 *
 * `production_run_id` is intentionally a plain text field rather than a DML
 * relationship — the existing run model uses the same flat style for
 * design_id / parent_run_id / order_id and we want this table to be
 * append-only without forcing a generated reverse relation on the run row.
 */
const ProductionRunActivity = model.define("production_run_activity", {
  id: model.id({ prefix: "prun_act" }).primaryKey(),

  production_run_id: model.text().searchable(),

  // Coarse classifier. Add new values as new sources start writing here.
  activity_type: model.enum([
    "reminder_sent",
    "lifecycle_event",
    "note",
    "system",
  ]),

  // Fine-grained type within the activity_type bucket.
  // For reminder_sent  → "assignment_pending" | "not_started" | "idle"
  // For lifecycle_event → matches the event suffix: "sent_to_partner",
  //                        "accepted", "started", "finished", "completed",
  //                        "cancelled"
  // For note            → free text (e.g. "admin_comment")
  kind: model.text(),

  // Who/what triggered this activity. actor_type is the bucket; actor_id
  // is the concrete identifier for the audit trail.
  actor_type: model
    .enum(["system", "admin", "partner", "scheduled_flow"])
    .default("system"),
  actor_id: model.text().nullable(),

  // Optional context that's almost always useful for filtering.
  partner_id: model.text().nullable(),

  // When this activity dispatched a message, these point at the messaging
  // system row + Meta-approved template name. Null for non-message activities.
  channel: model.enum(["whatsapp", "email", "in_app"]).nullable(),
  message_id: model.text().nullable(),
  template_name: model.text().nullable(),
  recipient: model.text().nullable(),

  // Short human-readable line for the timeline. Computed at write time.
  summary: model.text().nullable(),

  // Type-specific structured extras. NOT a generic metadata grab-bag —
  // anything that consumers regularly filter on should graduate to a
  // first-class column. Acceptable contents: producedQty/quantity for idle
  // reminders, days_since for time-based reminders, reason for cancellations.
  payload: model.json().nullable(),

  // Distinct from created_at: occurred_at is the moment the underlying
  // event happened (often = event emission time, sometimes back-dated when
  // we record retroactively). Indexed for the timeline query.
  occurred_at: model.dateTime(),
})

export default ProductionRunActivity
