import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { PLATFORM_TAX_IDENTITY_MODULE } from "../platform-tax-identity"
import {
  normalizeCountryCode,
  resolveExportIgstStatus,
  type ExportIgstStatus,
  type PlatformExportLutRow,
} from "../platform-tax-identity/resolve-lib"

/**
 * Resolve the IGST payment status to declare on an export (#1216).
 *
 * Shiprocket classifies a complete commercial export body as CSB-5, which
 * rejects `igstPaymentStatus: "A"` outright. The remaining values say how the
 * exporter discharges the zero-rating: `"B"` with an LUT on file (no IGST paid),
 * `"C"` without one (IGST paid, reclaimed as a refund).
 *
 * I/O lives here (container + the `platform_export_lut` table); the window math
 * is the pure `resolveExportIgstStatus`. Mirrors how `seller-tax-id.ts` splits
 * loading from resolution.
 *
 * BEST-EFFORT, failing to `"C"`: a query error, a missing table or an empty
 * result must never produce `"B"`. Claiming to have paid IGST you didn't is a
 * bookkeeping correction; claiming an exemption you aren't entitled to is a false
 * declaration — so uncertainty resolves toward the safe side, and a label is
 * never blocked on this lookup.
 */

/** ISO-2 of the jurisdiction an LUT applies to — an LUT is a GST instrument. */
const LUT_COUNTRY = "IN"

/**
 * Load export LUTs belonging to the tax identity registered for `country`.
 *
 * Reads the LUTs with their parent identity inlined, then keeps the rows whose
 * identity is active and covers the country — the identity fields are needed
 * anyway to prove the LUT belongs to the *exporting* registration (the Indian
 * GSTIN), not another brand entity.
 */
async function loadExportLuts(
  container: MedusaContainer,
  country: string
): Promise<PlatformExportLutRow[]> {
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "platform_export_lut",
      fields: [
        "id",
        "arn",
        "financial_year",
        "valid_from",
        "valid_to",
        "is_active",
        // Dotted paths, never `*tax_identity` — a star on a relation silently
        // drops it from the result (memory: query_graph_star_relation_silent_drop).
        "tax_identity.id",
        "tax_identity.is_active",
        "tax_identity.country_codes",
        "tax_identity.tax_id_type",
      ],
    })

    const code = normalizeCountryCode(country)
    return ((data ?? []) as any[]).filter((row) => {
      const identity = row?.tax_identity
      if (!identity || identity.is_active === false) {
        return false
      }
      const codes = (identity.country_codes ?? [])
        .map((c: string) => normalizeCountryCode(c))
        .filter(Boolean)
      return code ? codes.includes(code) : false
    }) as PlatformExportLutRow[]
  } catch {
    // Best-effort — never block a label on this lookup.
    return []
  }
}

export type ExportIgstResolution = {
  status: ExportIgstStatus
  /** ARN of the LUT relied on, when one is in force — for audit//display. */
  lut_arn?: string
  financial_year?: string
  /** Days until the LUT lapses; negative is impossible (expired ⇒ no LUT). */
  days_until_expiry?: number
}

/**
 * The status to declare right now, plus which LUT (if any) justified it.
 *
 * `now` is injectable so callers and tests can evaluate a specific instant —
 * the FY boundary is the case that matters.
 */
export async function resolveExportIgstForCountry(
  container: MedusaContainer,
  country: string = LUT_COUNTRY,
  now: Date = new Date()
): Promise<ExportIgstResolution> {
  const luts = await loadExportLuts(container, country)
  const { status, lut } = resolveExportIgstStatus(luts, now)
  if (!lut) {
    return { status }
  }
  const validTo = lut.valid_to ? new Date(lut.valid_to as any) : null
  return {
    status,
    lut_arn: typeof lut.arn === "string" ? lut.arn : undefined,
    financial_year:
      typeof lut.financial_year === "string" ? lut.financial_year : undefined,
    days_until_expiry:
      validTo && !Number.isNaN(validTo.getTime())
        ? Math.ceil((validTo.getTime() - now.getTime()) / 86_400_000)
        : undefined,
  }
}
