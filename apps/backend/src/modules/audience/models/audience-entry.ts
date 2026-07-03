import { model } from "@medusajs/framework/utils"

/**
 * The unified, deduped audience — ONE row per email, merging the three sources
 * the send unions (person / customer / lead). This is the "merge the leads,
 * customers and persons into one tagged list" artifact (#881): each entry
 * carries its inferred `source`, the `groups` it belongs to, and cross-cutting
 * `tags`, so a send can target `groups`/`tags` and resolve to emails directly.
 *
 * Materialized by the classifier backfill from the source-of-truth records; a
 * refresh job keeps it current. `member_type`/`member_id` point back at the
 * primary source record for that email.
 */
const AudienceEntry = model.define("audience_entry", {
  id: model.id({ prefix: "aud_entry" }).primaryKey(),
  // The join key — unique per audience. Lower-cased.
  email: model.text().searchable(),
  member_type: model.enum(["person", "customer", "lead"]),
  member_id: model.text(),
  first_name: model.text().nullable(),
  last_name: model.text().nullable(),
  // Inferred origin (weaver-directory | organic | customer | ad-lead | unknown).
  source: model.text().nullable(),
  // Group keys this entry belongs to (denormalized for fast send-time filtering).
  groups: model.json().nullable(),
  // Cross-cutting labels (source + flags: subscriber | onboarding-finished |
  // bounced | unsubscribed | gi-product | …).
  tags: model.json().nullable(),
  // Whether this contact is currently mailable (not bounced/unsubscribed, and —
  // for persons — has an active email subscription).
  mailable: model.boolean().default(true),
  metadata: model.json().nullable(),
})

export default AudienceEntry
