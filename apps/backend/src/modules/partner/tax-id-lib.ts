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

// ── Validation on the way IN ─────────────────────────────────────────────────
//
// `resolvePartnerTaxId` above decides which tax ID a document carries. This
// half decides whether a tax ID should ever have been stored in the first
// place, and it exists because of a gap found while reviewing #2120:
//
// `PUT /admin/partners/:id` registers NO body validator — `middlewares: []` —
// and the handler spreads its body straight into the update. (The MCP
// field-coverage suite lists `admin:update_partner` among routes that
// "validate inside the handler"; it does not. It validates nowhere.)
//
// That was survivable while the writable fields were names and flags. It is not
// survivable for `tax_id`: the value goes onto Delhivery's `seller_gst_tin`,
// Shiprocket's `gstin` and invoices, and a malformed one is not caught by us —
// it is caught by a carrier rejecting a shipment, or not caught at all.
//
// 🔴 A format check is NOT a verification. A well-formed GSTIN can belong to
// nobody. This rejects garbage at the door; it does not confirm the number is
// live or that it belongs to this partner. Nothing here should ever be
// described as "verified".

/** The tax-ID types we know how to talk about. Free text is still accepted. */
export const KNOWN_TAX_ID_TYPES = ["GSTIN", "VAT", "PAN"] as const

/**
 * Indian GSTIN: 15 characters.
 *   2  state code
 *   10 PAN          (5 letters, 4 digits, 1 letter)
 *   1  entity code for that PAN within the state
 *   1  literal 'Z'
 *   1  checksum
 * Government-mandated and fixed, which is why pinning it is safe.
 */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Indian PAN: 5 letters, 4 digits, 1 letter. */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/

export type TaxIdentityVerdict =
  | { ok: true; tax_id: string | null; tax_id_type: string | null }
  | { ok: false; error: string }

/**
 * Validate and normalise a partner's tax identity before it is stored.
 *
 * Only call this when the caller actually supplied one of the two fields —
 * absence is not an error, it is the ordinary state of a partner who has not
 * told us their registration yet.
 *
 * Explicit `null` is allowed and means "clear it", which is a real thing to
 * want: a wrongly-entered GSTIN must be removable, and refusing to clear it
 * would leave bad data on a compliance field forever.
 */
export function validateTaxIdentity(input: {
  tax_id?: string | null
  tax_id_type?: string | null
}): TaxIdentityVerdict {
  const rawId = input.tax_id
  const rawType = input.tax_id_type

  // Clearing: both go together. Keeping a type with no number leaves a row
  // claiming "this is a GSTIN" about nothing.
  if (rawId === null || (typeof rawId === "string" && rawId.trim() === "")) {
    return { ok: true, tax_id: null, tax_id_type: null }
  }

  if (rawId !== undefined && typeof rawId !== "string") {
    return { ok: false, error: `tax_id must be a string, received ${typeof rawId}` }
  }

  const id = rawId === undefined ? null : rawId.trim().toUpperCase()

  const type =
    rawType === null || rawType === undefined
      ? null
      : typeof rawType === "string"
        ? rawType.trim().toUpperCase()
        : undefined

  if (type === undefined) {
    return {
      ok: false,
      error: `tax_id_type must be a string, received ${typeof rawType}`,
    }
  }

  // A bare number cannot be printed or checked correctly, because nothing says
  // what it is. Required alongside an id rather than guessed from its shape —
  // guessing is how a VAT number becomes a "GSTIN" that fails at a border.
  if (id && !type) {
    return {
      ok: false,
      error:
        "tax_id_type is required when setting tax_id (e.g. 'GSTIN', 'VAT', 'PAN') — a number with no type cannot be printed or checked",
    }
  }

  if (type === "GSTIN" && id && !GSTIN_RE.test(id)) {
    return {
      ok: false,
      error: `'${id}' is not a valid GSTIN. Expected 15 characters: 2-digit state code, 10-character PAN, entity code, 'Z', checksum (e.g. '21AALCK3037B1Z4'). This is a FORMAT check only — it does not confirm the number is registered.`,
    }
  }

  if (type === "PAN" && id && !PAN_RE.test(id)) {
    return {
      ok: false,
      error: `'${id}' is not a valid PAN. Expected 10 characters: 5 letters, 4 digits, 1 letter.`,
    }
  }

  return { ok: true, tax_id: id, tax_id_type: type }
}
