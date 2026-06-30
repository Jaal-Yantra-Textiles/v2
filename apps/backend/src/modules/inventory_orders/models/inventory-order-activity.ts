import { model } from "@medusajs/framework/utils";

/**
 * First-class activity log row attached to an inventory order (#778 H4).
 *
 * Captures discrete events on an order — lifecycle/status transitions, partner
 * assignment + rollback, future notes — so the order timeline can be rendered
 * without stuffing arrays into `inventory_orders.metadata`. Mirrors
 * `production_run_activity` so both surfaces behave the same.
 *
 * `inventory_order_id` is a plain text field (not a DML relationship) so the
 * table stays append-only and we don't force a generated reverse relation onto
 * the order row.
 */
const InventoryOrderActivity = model.define("inventory_order_activity", {
  id: model.id({ prefix: "inv_ord_act" }).primaryKey(),

  inventory_order_id: model.text().searchable(),

  // Coarse classifier. Add new values as new sources start writing here.
  activity_type: model.enum([
    "lifecycle_event",
    "reminder_sent",
    "note",
    "system",
  ]),

  // Fine-grained type within the activity_type bucket.
  // For lifecycle_event → "status_changed" | "assigned_to_partner" |
  //                        "partner_link_rolled_back" | "started" |
  //                        "completed" | "partial" | "cancelled" | "payment"
  // For reminder_sent   → "overdue" | "due_soon"
  // For note            → free text (e.g. "admin_comment")
  kind: model.text(),

  actor_type: model
    .enum(["system", "admin", "partner", "scheduled_flow"])
    .default("system"),
  actor_id: model.text().nullable(),

  partner_id: model.text().nullable(),

  // When this activity dispatched a message, these point at the messaging row
  // + Meta-approved template. Null for non-message activities.
  channel: model.enum(["whatsapp", "email", "in_app"]).nullable(),
  message_id: model.text().nullable(),
  template_name: model.text().nullable(),
  recipient: model.text().nullable(),

  // Short human-readable line for the timeline. Computed at write time.
  summary: model.text().nullable(),

  // Type-specific structured extras (e.g. previous_status/status for a
  // transition). Not a generic grab-bag — promote anything regularly filtered
  // on to a first-class column.
  payload: model.json().nullable(),

  // The moment the underlying event happened (often = event emission time).
  occurred_at: model.dateTime(),
});

export default InventoryOrderActivity;
