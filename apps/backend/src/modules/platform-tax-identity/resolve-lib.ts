/**
 * Platform tax-identity resolution (issue #348, slice B).
 *
 * When a partner has not supplied their OWN tax / GST / VAT registration ID, the
 * platform must stamp shipping labels under one of its own brand entities (JYT in
 * India, KHT in the EU) so the documents stay legally valid. Those fallback IDs
 * are NOT per-partner (every IN partner without an ID shares the *same* JYT
 * GSTIN) — they live in the admin-managed `platform_tax_identity` table, one row
 * per brand/jurisdiction.
 *
 * This module is a PURE library (no container, no I/O): given the rows and a
 * country it picks the right fallback. The I/O wrapper that loads the rows and
 * composes the partner-own precedence lives in
 * `modules/shipping-providers/seller-tax-id.ts`.
 */

/** A row of the `platform_tax_identity` table (only the fields we resolve on). */
export interface PlatformTaxIdentityRow {
  brand_code?: string | null
  legal_name?: string | null
  tax_id?: string | null
  tax_id_type?: string | null
  /** ISO alpha-2 country codes this identity is registered to bill under. */
  country_codes?: string[] | null
  is_active?: boolean | null
}

/** The 27 EU member-state ISO alpha-2 codes (KHT's VAT jurisdiction). */
export const EU_VAT_COUNTRY_CODES: string[] = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
]

/**
 * Normalise a country value to an upper-case ISO alpha-2 code. Accepts the code
 * itself (`"in"`, `"IN"`); anything that isn't a 2-letter token returns null so
 * we never match a fallback on a malformed/long value.
 */
export function normalizeCountryCode(country?: string | null): string | null {
  if (typeof country !== "string") {
    return null
  }
  const code = country.trim().toUpperCase()
  return /^[A-Z]{2}$/.test(code) ? code : null
}

/**
 * Resolve the platform fallback identity for a country: the FIRST active row
 * whose `country_codes` includes that country. Returns null when no active row
 * covers the jurisdiction (→ caller falls through to source "none").
 */
export function resolvePlatformTaxIdentity(
  country: string | null | undefined,
  identities: PlatformTaxIdentityRow[] | null | undefined
): PlatformTaxIdentityRow | null {
  const code = normalizeCountryCode(country)
  if (!code) {
    return null
  }
  for (const row of identities ?? []) {
    if (!row || row.is_active === false) {
      continue
    }
    const codes = (row.country_codes ?? [])
      .map((c) => normalizeCountryCode(c))
      .filter((c): c is string => Boolean(c))
    if (codes.includes(code)) {
      return row
    }
  }
  return null
}

/**
 * Convenience: the fallback tax-ID STRING for a country (or undefined). Trims
 * empty values so a present-but-blank `tax_id` resolves to undefined.
 */
export function resolvePlatformTaxIdString(
  country: string | null | undefined,
  identities: PlatformTaxIdentityRow[] | null | undefined
): string | undefined {
  const row = resolvePlatformTaxIdentity(country, identities)
  const id = typeof row?.tax_id === "string" ? row.tax_id.trim() : ""
  return id.length ? id : undefined
}
