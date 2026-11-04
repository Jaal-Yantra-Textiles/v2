import { model } from "@medusajs/framework/utils"

/**
 * A read-only, no-login link to one design's moodboard, or to every design in
 * a bundle (#2500).
 *
 * ## Why this is not a designer invite
 *
 * A `designer_invite` is an ONBOARDING link: the page asks the viewer to
 * accept, accepting creates a `designer` partner and links the design to it,
 * and the invite then dies. Sent to a production unit that is already our
 * partner, every accept would mint a stray designer account and the second
 * person at the unit to open it would find it dead. A unit needs to LOOK at
 * the boards, many times, from many phones — so this link grants viewing and
 * nothing else, and stays live until it expires or is revoked.
 *
 * ## Scope
 *
 * `scope = "order"` shares every design on a (collated) design work order —
 * the "bundle" the admin Bundles view groups by. `scope = "design"` shares one
 * design. The designs are read at VIEW time, not frozen at mint time, so a
 * board edited after the link went out shows the edit.
 *
 * The raw token lives only in the URL; `token_hash` (sha256) is what we keep,
 * exactly as the invite does.
 */
const DesignPreviewLink = model.define("design_preview_link", {
  id: model.id().primaryKey(),
  scope: model.enum(["order", "design"]),
  /** The order id for `order` scope, the design id for `design` scope. */
  scope_id: model.text(),
  token_hash: model.text().unique(),
  /** Who it was sent to — informational; the token is the capability. */
  partner_id: model.text().nullable(),
  /** Heading on the page, e.g. "Bundle #152". */
  label: model.text().nullable(),
  expires_at: model.dateTime().nullable(),
  revoked_at: model.dateTime().nullable(),
  created_by: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default DesignPreviewLink
