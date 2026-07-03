import { model } from "@medusajs/framework/utils"

/**
 * A named audience segment. Groups are how the operator targets a send at a
 * subset instead of the whole flat list (#881). `kind`:
 *   - source: auto-derived from where a contact came from (weaver-directory,
 *     organic, customers, ad-leads) — populated by the classifier backfill.
 *   - manual: an operator-curated list.
 *   - smart: rule-defined (future).
 */
const AudienceGroup = model.define("audience_group", {
  id: model.id({ prefix: "aud_grp" }).primaryKey(),
  // Stable slug used by the send path + classifier (e.g. "weaver-directory").
  key: model.text().searchable(),
  label: model.text(),
  kind: model.enum(["source", "manual", "smart"]).default("source"),
  description: model.text().nullable(),
  metadata: model.json().nullable(),
})

export default AudienceGroup
