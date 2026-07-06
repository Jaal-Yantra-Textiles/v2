import { model } from "@medusajs/framework/utils"

/**
 * Raw per-event ledger — one row per delivery/open/click webhook event. Serves
 * two jobs: (1) idempotency, so a re-delivered webhook doesn't double-count the
 * aggregate (dedup on `event_id`); (2) a debuggable audit trail of exactly what
 * each ESP told us. The aggregate `email_engagement` is the denormalized rollup
 * of these rows — same pattern as `email_suppression`.
 */
const EmailEngagementEvent = model.define("email_engagement_event", {
  id: model.id({ prefix: "email_enge" }).primaryKey(),
  email: model.text().searchable(),
  // Normalized event type. `delivered` = Mailjet `sent` / Resend `email.delivered`.
  type: model.enum(["delivered", "open", "click"]).default("delivered"),
  provider: model.enum(["mailjet", "resend", "other"]).default("other"),
  // Provider-side idempotency key (per message + type) — nullable when the ESP
  // gave us no message id.
  event_id: model.text().nullable(),
  event_at: model.dateTime().nullable(),
  // The ESP message id this event belongs to (Mailjet MessageID / Resend email_id).
  message_id: model.text().nullable(),
  raw: model.json().nullable(),
})

export default EmailEngagementEvent
