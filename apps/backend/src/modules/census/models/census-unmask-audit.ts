import { model } from "@medusajs/framework/utils"

/**
 * Durable audit row for one admin reveal of a weaver's FULL PII (the encrypted
 * sensitive core, unmasked via the reader node). Written on every
 * `GET /admin/census/weavers/:census_id/unmask` — best-effort, never blocks the
 * reveal itself. `census_id` is the record revealed; `actor_id` is the admin
 * who asked; `fields` is `{ keys: string[] }` — the names of the sensitive keys
 * returned — so a review can see WHAT leaked without re-storing the values.
 *
 * This is the ONLY Postgres table in the otherwise read-only (P2P) census
 * module — the audit trail must be queryable and durable independent of the
 * P2P core.
 */
const CensusUnmaskAudit = model.define("census_unmask_audit", {
  id: model.id().primaryKey(),
  census_id: model.text(),
  actor_id: model.text().nullable(),
  fields: model.json().nullable(),
})

export default CensusUnmaskAudit