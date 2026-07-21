import { model } from "@medusajs/framework/utils"

/**
 * A scoped invite that onboards a (possibly brand-new) Designer partner onto a
 * single design's authoring surface — the #1113 "Figma-style" invite.
 *
 * The raw token only ever lives in the invite URL; we persist `token_hash`
 * (sha256) so a DB read can't reconstruct a working link. Single-use +
 * revocable via `status`; optional `email` locks the invite to one recipient.
 */
const DesignerInvite = model.define("designer_invite", {
  id: model.id().primaryKey(),
  // The design being shared (a brief assembled by the brand/admin).
  design_id: model.text(),
  // Optional recipient lock — when set, accept must present this email.
  email: model.text().nullable(),
  // sha256(raw token). The raw token is returned once at mint time only.
  token_hash: model.text().unique(),
  status: model.enum(["pending", "accepted", "revoked"]).default("pending"),
  // Grant role stamped onto the design↔partner link on accept.
  role: model.text().nullable(),
  expires_at: model.dateTime().nullable(),
  // Admin actor id that minted the invite.
  invited_by: model.text().nullable(),
  // Display name for the landing page ("Invited by <brand>").
  inviter_name: model.text().nullable(),
  accepted_partner_id: model.text().nullable(),
  accepted_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
})

export default DesignerInvite
