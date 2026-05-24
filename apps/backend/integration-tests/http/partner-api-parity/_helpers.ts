// Partner API ↔ Admin API parity helpers.
//
// Used by specs under integration-tests/http/partner-api-parity/ to
// assert that partner routes mirror their admin counterpart's wire
// shape. Per apps/docs/notes/PARTNER_API_PARITY.md:
//
//   • Top-level envelope keys must match exactly (strict equality).
//   • Resource object keys: partner is a SUPERSET of admin's keys —
//     partner is allowed to add enrichment fields (e.g.
//     `payment_providers` inlined on region GET), but every admin key
//     must still be present.
//
// Values are allowed to differ (admin sees all rows, partner sees only
// their scoped rows). These helpers are purely shape assertions.

/**
 * Assert two response payloads have identical top-level keys.
 * Used to catch "partner invented a new envelope key" drift.
 */
export function assertEnvelopeShape(
  admin: unknown,
  partner: unknown,
  context = ""
) {
  const adminKeys = Object.keys(admin as object).sort()
  const partnerKeys = Object.keys(partner as object).sort()
  const ctx = context ? ` (${context})` : ""
  expect(partnerKeys).toEqual(adminKeys)
}

/**
 * Assert the partner resource object has every key the admin resource has.
 * Partner may add additional enrichment fields — those don't fail the test.
 *
 * Pass `ignoreKeys` to skip known divergences (admin-only fields that
 * partner intentionally doesn't expose, or admin-side fields that don't
 * meaningfully exist for a partner-scoped row).
 */
export function assertResourceShape<T extends Record<string, unknown>>(
  adminResource: T | undefined | null,
  partnerResource: T | undefined | null,
  options: { ignoreKeys?: string[]; context?: string } = {}
) {
  if (!adminResource || !partnerResource) return // tolerate absence on either side
  const ignore = new Set(options.ignoreKeys ?? [])
  const adminKeys = Object.keys(adminResource).filter((k) => !ignore.has(k)).sort()
  const partnerKeys = new Set(Object.keys(partnerResource))
  const missing = adminKeys.filter((k) => !partnerKeys.has(k))
  const ctx = options.context ? ` (${options.context})` : ""
  expect(missing).toEqual([])
}
