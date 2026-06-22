/**
 * Tax-ID fallback resolution (issue #348).
 *
 * When a partner has not supplied their own tax / GST / registration ID, the
 * platform must bill orders, invoices and shipping labels under its own brand
 * tax ID (JYT or KHT, brand-dependent) so the documents stay legally valid.
 *
 * This module is a PURE library (no container, no I/O beyond an injectable env
 * read) so the fallback logic can be unit-tested in isolation and reused at any
 * generation point (Delhivery `seller_gst_tin`, Shiprocket `gstin`, invoices).
 */

export type TaxIdBrand = "JYT" | "KHT"

export type ResolvedTaxIdSource = "partner" | "platform" | "none"

export interface PlatformTaxIds {
  JYT?: string | null
  KHT?: string | null
}

export interface ResolvePartnerTaxIdInput {
  /** The partner's own tax ID (e.g. `partner.tax_id`); may be null/empty. */
  partnerTaxId?: string | null
  /** The partner's tax-ID type (e.g. `partner.tax_id_type`); carried through. */
  partnerTaxIdType?: string | null
  /** Brand the order/document is billed under; defaults to `defaultBrand`. */
  brand?: string | null
  /** Platform fallback tax IDs, keyed by brand (see `getPlatformTaxIds`). */
  platformTaxIds?: PlatformTaxIds | null
  /** Brand used when `brand` is missing/unrecognised. Defaults to "JYT". */
  defaultBrand?: TaxIdBrand
}

export interface ResolvedTaxId {
  /** The effective tax ID to stamp on the document, or null if none available. */
  taxId: string | null
  /** Where `taxId` came from: the partner, the platform fallback, or nothing. */
  source: ResolvedTaxIdSource
  /** The brand the fallback resolved against (normalised). */
  brand: TaxIdBrand
  /** Tax-ID type when sourced from the partner; null for platform/none. */
  taxIdType: string | null
}

export const KNOWN_BRANDS: TaxIdBrand[] = ["JYT", "KHT"]

const DEFAULT_BRAND: TaxIdBrand = "JYT"

/** Trim a string-ish value; treat empty/whitespace/non-strings as null. */
function clean(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/**
 * Normalise an arbitrary brand string to a known `TaxIdBrand`, falling back to
 * `defaultBrand` for missing/unrecognised values. Case-insensitive.
 */
export function normalizeBrand(
  brand?: string | null,
  defaultBrand: TaxIdBrand = DEFAULT_BRAND
): TaxIdBrand {
  const cleaned = clean(brand)
  if (!cleaned) {
    return defaultBrand
  }
  const upper = cleaned.toUpperCase()
  return (KNOWN_BRANDS as string[]).includes(upper)
    ? (upper as TaxIdBrand)
    : defaultBrand
}

/**
 * Resolve the effective tax ID for a document.
 *
 * Precedence: the partner's own tax ID wins; otherwise fall back to the
 * platform tax ID for the resolved brand; otherwise `null` (source "none").
 */
export function resolvePartnerTaxId(
  input: ResolvePartnerTaxIdInput
): ResolvedTaxId {
  const brand = normalizeBrand(input.brand, input.defaultBrand ?? DEFAULT_BRAND)
  const partnerTaxId = clean(input.partnerTaxId)

  if (partnerTaxId) {
    return {
      taxId: partnerTaxId,
      source: "partner",
      brand,
      taxIdType: clean(input.partnerTaxIdType),
    }
  }

  const platform = input.platformTaxIds ?? {}
  const fallback = clean(platform[brand])
  if (fallback) {
    return { taxId: fallback, source: "platform", brand, taxIdType: null }
  }

  return { taxId: null, source: "none", brand, taxIdType: null }
}

/**
 * Read the platform fallback tax IDs from the environment. Takes an explicit
 * `env` object so it stays unit-testable; defaults to `process.env`.
 *
 * Configure via `JYT_PLATFORM_TAX_ID` / `KHT_PLATFORM_TAX_ID`.
 */
export function getPlatformTaxIds(
  env: Record<string, string | undefined> = process.env
): PlatformTaxIds {
  return {
    JYT: clean(env.JYT_PLATFORM_TAX_ID),
    KHT: clean(env.KHT_PLATFORM_TAX_ID),
  }
}
