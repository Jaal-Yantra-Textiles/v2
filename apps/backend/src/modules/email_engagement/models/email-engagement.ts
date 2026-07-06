import { model } from "@medusajs/framework/utils"

/**
 * One aggregate row per email — the durable engagement ledger that answers
 * "is this address still reading our mail?". Fed by the Mailjet + Resend
 * delivery/open/click webhooks (the events those routes used to drop), it is the
 * denominator+numerator the engagement recompute reads to classify a contact as
 * engaged / cooling / dormant / never_opened and, in soft-exclusion, drop the
 * dormant ones from BULK sends without hiding them (they stay visible). Sibling
 * of `email_suppression` (hard bounce/complaint/unsub) — this is the softer,
 * behavioural signal. (#881 / #839)
 */
const EmailEngagement = model.define("email_engagement", {
  id: model.id({ prefix: "email_eng" }).primaryKey(),
  // Join key — sends dedupe recipients by email across person/customer/lead, so
  // engagement is tracked per email just like suppression.
  email: model.text().searchable(),
  // Denominator (deliveries) + engagement signals. A delivered event is the
  // closest per-recipient "campaign reached them" marker both ESPs give us
  // (Mailjet `sent`, Resend `email.delivered`).
  delivered_count: model.number().default(0),
  opens_count: model.number().default(0),
  clicks_count: model.number().default(0),
  // The cold-streak signal: deliveries since we last saw ANY open/click. Reset to
  // 0 on any engagement. Drives the dormancy threshold. Approximate under
  // out-of-order webhooks — but an open always zeroes it, so it errs toward
  // KEEPING people (conservative, never over-suppresses).
  delivered_since_last_open: model.number().default(0),
  first_delivered_at: model.dateTime().nullable(),
  last_delivered_at: model.dateTime().nullable(),
  last_open_at: model.dateTime().nullable(),
  last_click_at: model.dateTime().nullable(),
  // Latest of any engagement/delivery event we've seen for this address.
  last_event_at: model.dateTime().nullable(),
  // Persisted classification (written by the recompute job) — for visibility +
  // win-back selection. The send-path gate recomputes live from the counters
  // above, so a stale status here never causes a wrong exclusion.
  engagement_status: model
    .enum(["engaged", "cooling", "dormant", "never_opened", "unknown"])
    .default("unknown"),
  status_computed_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default EmailEngagement
