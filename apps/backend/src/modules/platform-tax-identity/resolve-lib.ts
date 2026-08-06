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

/**
 * Export LUT resolution (#1216).
 *
 * An export of goods is zero-rated whether or not an LUT is on file — the LUT
 * only decides how the exporter discharges that: `"B"` (LUT/bond, no IGST paid)
 * or `"C"` (IGST paid on the export invoice and reclaimed). There is no third
 * option once Shiprocket classifies the shipment as CSB-5, which rejects `"A"`.
 *
 * The whole reason this is data rather than a flag: an LUT covers ONE financial
 * year and must be re-furnished each April. A flag has no expiry, so the day the
 * LUT lapses every export would keep claiming `"B"` — a false declaration,
 * discovered by nobody. So this resolves on the validity WINDOW and fails toward
 * `"C"`: claiming to have paid IGST you didn't is a recoverable bookkeeping
 * error, claiming an exemption you aren't entitled to is not.
 *
 * Pure (no container, no clock of its own — `now` is injected) so the FY-boundary
 * behaviour is unit-testable. The I/O wrapper lives in
 * `modules/shipping-providers/export-igst.ts`.
 */

/** A row of `platform_export_lut` (only the fields resolution reads). */
export interface PlatformExportLutRow {
  id?: string | null
  arn?: string | null
  financial_year?: string | null
  valid_from?: string | Date | null
  valid_to?: string | Date | null
  is_active?: boolean | null
}

/** Shiprocket's IGST payment status: B = LUT/bond, C = paid and reclaimed. */
export type ExportIgstStatus = "B" | "C"

/** Coerce a date-ish value to a Date, or null when unusable. */
function toDate(value?: string | Date | null): Date | null {
  if (!value) {
    return null
  }
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * The LUT in force at `now`: active, with a validity window covering the moment.
 * When several qualify (an early renewal overlapping the outgoing year) the one
 * with the LATEST `valid_from` wins — the most recently furnished cover.
 *
 * A row missing either bound is skipped rather than treated as open-ended: an
 * LUT without an end date would never expire, reintroducing exactly the silent
 * over-claim this model exists to prevent.
 */
export function resolveActiveExportLut(
  luts: PlatformExportLutRow[] | null | undefined,
  now: Date = new Date()
): PlatformExportLutRow | null {
  let best: PlatformExportLutRow | null = null
  let bestFrom = -Infinity

  for (const row of luts ?? []) {
    if (!row || row.is_active === false) {
      continue
    }
    if (typeof row.arn !== "string" || !row.arn.trim()) {
      // No ARN means it was never actually furnished.
      continue
    }
    const from = toDate(row.valid_from)
    const to = toDate(row.valid_to)
    if (!from || !to) {
      continue
    }
    if (now < from || now > to) {
      continue
    }
    if (from.getTime() >= bestFrom) {
      best = row
      bestFrom = from.getTime()
    }
  }

  return best
}

/**
 * The IGST payment status to declare: `"B"` only when an LUT is in force right
 * now, `"C"` in every other case (none on file, expired, withdrawn, malformed).
 */
export function resolveExportIgstStatus(
  luts: PlatformExportLutRow[] | null | undefined,
  now: Date = new Date()
): { status: ExportIgstStatus; lut: PlatformExportLutRow | null } {
  const lut = resolveActiveExportLut(luts, now)
  return { status: lut ? "B" : "C", lut }
}

/**
 * Days until an active LUT lapses — what the expiry notification keys off.
 * Returns null when nothing is in force (there is no expiry to warn about; the
 * declaration is already the safe `"C"`).
 */
export function daysUntilLutExpiry(
  luts: PlatformExportLutRow[] | null | undefined,
  now: Date = new Date()
): number | null {
  const lut = resolveActiveExportLut(luts, now)
  const to = toDate(lut?.valid_to)
  if (!to) {
    return null
  }
  return Math.ceil((to.getTime() - now.getTime()) / 86_400_000)
}
