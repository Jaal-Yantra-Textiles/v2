import { model } from "@medusajs/framework/utils"

/**
 * One row per suppression event — the durable, queryable log of "why is this
 * address off the list". Written by BOTH the provider bounce/complaint webhooks
 * (Mailjet + Resend) and the manual CSV Data-Plumbing job, so bounce state has a
 * single source of truth instead of only living in scattered `metadata.bounced`
 * flags (those become a denormalized cache of the latest row here). (#881 / #839)
 */
const EmailSuppression = model.define("email_suppression", {
  id: model.id({ prefix: "email_supp" }).primaryKey(),
  // The join key — the send path dedupes recipients by email across
  // person/customer/lead, so email is what we suppress on.
  email: model.text().searchable(),
  reason: model
    .enum(["hard_bounce", "soft_bounce", "spam_complaint", "unsubscribe", "manual"])
    .default("hard_bounce"),
  provider: model
    .enum(["mailjet", "resend", "manual", "other"])
    .default("other"),
  // Provider-side event id — used for idempotency so a re-delivered webhook is a
  // no-op. Nullable (manual runs have none).
  event_id: model.text().nullable(),
  // When the provider recorded the event (not when we processed it).
  event_at: model.dateTime().nullable(),
  // Did this event actually flip a record off (vs already-off / no match)?
  suppressed: model.boolean().default(false),
  // How many records were flipped, per source.
  persons: model.number().default(0),
  customers: model.number().default(0),
  leads: model.number().default(0),
  // Raw provider payload snippet (for debugging / audit).
  raw: model.json().nullable(),
  metadata: model.json().nullable(),
})

export default EmailSuppression
