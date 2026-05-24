// Partner region query-config
//
// Mirrors Medusa core's admin region query-config at
// `@medusajs/medusa/dist/api/admin/regions/query-config.js`. See
// `apps/docs/notes/PARTNER_API_PARITY.md` for the audit register and
// the rule that the default fields here must match admin exactly.
//
// Partner-specific enrichment (e.g. inlined `payment_providers` on the
// single-region GET) is added *inside the handler*, not here — keeping
// the wire contract identical to admin while still surfacing partner-
// useful joins.

export const defaultPartnerRegionFields = [
  "id",
  "name",
  "currency_code",
  "created_at",
  "updated_at",
  "deleted_at",
  "automatic_taxes",
  "metadata",
  "*countries",
]

export const retrieveTransformQueryConfig = {
  defaults: defaultPartnerRegionFields,
  isList: false,
}

export const listTransformQueryConfig = {
  defaults: defaultPartnerRegionFields,
  defaultLimit: 20,
  isList: true,
}
