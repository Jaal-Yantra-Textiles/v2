/**
 * Indian financial-year helpers for the export-LUT form (#1216).
 *
 * Kept dependency-free (no UI imports) so the date maths is unit-testable — the
 * validity window is what makes an expired LUT stop justifying a zero-IGST
 * declaration, so getting it wrong is a compliance bug, not a cosmetic one.
 */

/**
 * "2026-27" → 1 Apr 2026 … 31 Mar 2027, as `yyyy-mm-dd` for date inputs.
 * Returns null for anything that isn't a well-formed FY label.
 */
export function financialYearWindow(
  fy: string
): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec((fy ?? "").trim())
  if (!m) {
    return null
  }
  const startYear = Number(m[1])
  // Expand the 2-digit end against the START year's century, then guard the
  // rollover: "2099-00" means 2100, not 2000.
  const sameCentury = Math.floor(startYear / 100) * 100 + Number(m[2])
  const endYear = sameCentury > startYear ? sameCentury : startYear + 1
  return { from: `${startYear}-04-01`, to: `${endYear}-03-31` }
}
