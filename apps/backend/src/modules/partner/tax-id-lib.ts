/**
 * Tax-ID fallback resolution (issue #348).
 *
 * When a partner has not supplied their own tax / GST / registration ID, the
 * platform must bill orders and shipping labels under its own brand tax ID so
 * the documents stay legally valid. The partner sells *through us*, so the brand
 * is jurisdiction-driven by the order / ship-from country:
 *
 *   - India (IN)        → JYT ("Jaal Yantra Textiles Private Limited", GSTIN)
 *   - EU member states  → KHT ("Kind Health Tech", EU VAT)
 *
 * Resolution order: `partner.tax_id` (own) → platform-by-country → none.
 *
 * This module is a PURE library (no container, no I/O beyond an injectable env
 * read) so the fallback logic can be unit-tested in isolation and reused at any
 * generation point (Delhivery `seller_gst_tin`, Shiprocket `gstin`, …).
 *
 * Slice A (PR #652) shipped the partner columns + the brand-keyed resolver.
 * Slice B adds the country→brand mapping + config so carrier labels can resolve
 * the fallback at generation time without a stored per-partner brand flag.
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
  /** Tax-ID type (partner-supplied or the platform brand's type); null if none. */
  taxIdType: string | null
}

export const KNOWN_BRANDS: TaxIdBrand[] = ["JYT", "KHT"]

const DEFAULT_BRAND: TaxIdBrand = "JYT"

/** Default tax-ID type per brand (overridable via env). */
const DEFAULT_BRAND_TAX_ID_TYPE: Record<TaxIdBrand, string> = {
  JYT: "gstin",
  KHT: "vat",
}

/**
 * ISO 3166-1 alpha-2 codes of the EU member states (KHT / EU-VAT jurisdiction).
 * Kept as code (not config) because it's stable jurisdiction logic, not a
 * deployment secret — only the tax-ID *numbers* come from env.
 */
export const EU_VAT_COUNTRY_CODES: ReadonlySet<string> = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE",
])

/** Trim a string-ish value; treat empty/whitespace/non-strings as null. */
function clean(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/** Normalise a country code/name to an upper-case ISO alpha-2 where possible. */
function normalizeCountry(country?: string | null): string | null {
  const cleaned = clean(country)
  if (!cleaned) {
    return null
  }
  const upper = cleaned.toUpperCase()
  // Common full-name aliases for the platform's primary jurisdiction.
  if (upper === "INDIA" || upper === "IND") {
    return "IN"
  }
  return upper
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
 * Map an order / ship-from country onto the platform brand whose tax ID applies:
 * India → JYT, EU member states → KHT. Returns `null` for jurisdictions the
 * platform has no registered entity in (→ no fallback, source "none").
 */
export function resolveBrandForCountry(
  country?: string | null
): TaxIdBrand | null {
  const code = normalizeCountry(country)
  if (!code) {
    return null
  }
  if (code === "IN") {
    return "JYT"
  }
  if (EU_VAT_COUNTRY_CODES.has(code)) {
    return "KHT"
  }
  return null
}

/**
 * Resolve the effective tax ID for a document by an explicit brand.
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
    return {
      taxId: fallback,
      source: "platform",
      brand,
      taxIdType: DEFAULT_BRAND_TAX_ID_TYPE[brand],
    }
  }

  return { taxId: null, source: "none", brand, taxIdType: null }
}

/** Platform tax-ID config, keyed by brand. Values typically come from env. */
export type PlatformTaxIdConfig = Record<
  TaxIdBrand,
  { taxId: string | null; taxIdType: string }
>

export interface ResolveTaxIdForCountryInput {
  /** The partner's own tax ID (`partner.tax_id`); may be null/empty. */
  partnerTaxId?: string | null
  /** The partner's tax-ID type (`partner.tax_id_type`); carried through. */
  partnerTaxIdType?: string | null
  /** Order / ship-from country (ISO alpha-2 or a name like "India"). */
  countryCode?: string | null
  /** Platform fallback config keyed by brand (see `getPlatformTaxIdConfig`). */
  config?: PlatformTaxIdConfig | null
}

/**
 * Country-aware resolution (slice B). Precedence:
 *   1. the partner's own tax ID (any country),
 *   2. the platform tax ID for the brand the country maps to (IN→JYT, EU→KHT),
 *   3. none.
 *
 * The brand for a platform fallback is derived from the country — there is no
 * stored per-partner brand flag, so labels stay stateless (no staleness/backfill).
 */
export function resolveTaxIdForCountry(
  input: ResolveTaxIdForCountryInput
): ResolvedTaxId {
  const brandForCountry = resolveBrandForCountry(input.countryCode)
  // Brand the *result* reports even when there's no fallback: prefer the
  // country's brand, else the platform default. Keeps `brand` meaningful.
  const reportBrand = brandForCountry ?? DEFAULT_BRAND

  const partnerTaxId = clean(input.partnerTaxId)
  if (partnerTaxId) {
    return {
      taxId: partnerTaxId,
      source: "partner",
      brand: reportBrand,
      taxIdType: clean(input.partnerTaxIdType),
    }
  }

  // No partner ID and no platform entity for this jurisdiction → none.
  if (!brandForCountry) {
    return { taxId: null, source: "none", brand: reportBrand, taxIdType: null }
  }

  const config = input.config ?? null
  const entry = config?.[brandForCountry]
  const fallback = clean(entry?.taxId)
  if (fallback) {
    return {
      taxId: fallback,
      source: "platform",
      brand: brandForCountry,
      taxIdType: entry?.taxIdType || DEFAULT_BRAND_TAX_ID_TYPE[brandForCountry],
    }
  }

  return { taxId: null, source: "none", brand: brandForCountry, taxIdType: null }
}

/**
 * Read the platform fallback tax IDs from the environment. Takes an explicit
 * `env` object so it stays unit-testable; defaults to `process.env`.
 *
 * Configure via `PLATFORM_TAX_ID_JYT` / `PLATFORM_TAX_ID_KHT`.
 */
export function getPlatformTaxIds(
  env: Record<string, string | undefined> = process.env
): PlatformTaxIds {
  return {
    JYT: clean(env.PLATFORM_TAX_ID_JYT),
    KHT: clean(env.PLATFORM_TAX_ID_KHT),
  }
}

/**
 * Build the brand-keyed platform tax-ID config from the environment. Takes an
 * explicit `env` for unit-testing; defaults to `process.env`.
 *
 * Env vars (placeholders until the real numbers are supplied):
 *   - `PLATFORM_TAX_ID_JYT`        — JYT GSTIN
 *   - `PLATFORM_TAX_ID_KHT`        — KHT EU VAT
 *   - `PLATFORM_TAX_ID_TYPE_JYT`   — optional, defaults to "gstin"
 *   - `PLATFORM_TAX_ID_TYPE_KHT`   — optional, defaults to "vat"
 *
 * This is also surfaced (documented) in `medusa-config.ts` / `.prod.ts` so the
 * mapping has a single discoverable home for ops; the runtime reads the same env.
 */
export function getPlatformTaxIdConfig(
  env: Record<string, string | undefined> = process.env
): PlatformTaxIdConfig {
  return {
    JYT: {
      taxId: clean(env.PLATFORM_TAX_ID_JYT),
      taxIdType: clean(env.PLATFORM_TAX_ID_TYPE_JYT) || DEFAULT_BRAND_TAX_ID_TYPE.JYT,
    },
    KHT: {
      taxId: clean(env.PLATFORM_TAX_ID_KHT),
      taxIdType: clean(env.PLATFORM_TAX_ID_TYPE_KHT) || DEFAULT_BRAND_TAX_ID_TYPE.KHT,
    },
  }
}
