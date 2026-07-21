import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import { resolveOrderPartnerId } from "./order-partner-origin"
import { PLATFORM_TAX_IDENTITY_MODULE } from "../platform-tax-identity"
import {
  resolvePlatformTaxIdString,
  type PlatformTaxIdentityRow,
} from "../platform-tax-identity/resolve-lib"

/**
 * Resolve the seller tax / GST / VAT registration ID to stamp on a carrier label
 * (#348 slice B).
 *
 * Precedence (locked on #348): the order's partner's OWN `tax_id` wins; otherwise
 * the admin-managed platform fallback for the ship-from country (IN→JYT GSTIN,
 * EU→KHT VAT) read from the `platform_tax_identity` table; otherwise none.
 *
 * I/O lives here (container + the partner↔order link + the platform table); the
 * fallback math is the pure `resolvePlatformTaxIdString`
 * (modules/platform-tax-identity/resolve-lib). The partner lookup is BEST-EFFORT
 * — a missing partner, link or query error degrades to the platform fallback
 * rather than blocking label generation.
 */

/** Trim a string-ish value; empty/whitespace/non-strings become null. */
function clean(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

/**
 * Load the active platform tax identities (best-effort → [] on any error).
 *
 * Read via `query.graph` — the idiomatic Medusa fetch, resolved from the Medusa
 * container. The `platform_tax_identity` module is a standard `model.define`
 * registration, so it IS exposed to the remote-query index (verified: a graph
 * read returns the seeded rows). We list all rows and let the pure resolver skip
 * inactive ones — boolean filters resolve unreliably across container scopes.
 */
async function loadActiveIdentities(
  container: MedusaContainer
): Promise<PlatformTaxIdentityRow[]> {
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: PLATFORM_TAX_IDENTITY_MODULE,
      fields: [
        "id",
        "brand_code",
        "legal_name",
        "tax_id",
        "tax_id_type",
        "country_codes",
        "is_active",
      ],
    })
    return (data ?? []) as PlatformTaxIdentityRow[]
  } catch {
    return []
  }
}

/**
 * The order's partner's own tax ID, or null (best-effort, never throws).
 *
 * Resolves the owning partner via BOTH scoping rules (#1111 S4): the D3
 * partner↔order work link AND retail sales-channel scoping — so a retail order's
 * partner GSTIN is stamped on its label instead of always falling through to the
 * platform GSTIN.
 */
async function resolvePartnerOwnTaxId(
  container: MedusaContainer,
  query: any,
  orderId: string | null | undefined
): Promise<string | null> {
  if (!orderId) {
    return null
  }
  try {
    const { partnerId } = await resolveOrderPartnerId(container, orderId)
    if (!partnerId) {
      return null
    }
    const { data: partners } = await query.graph({
      entity: "partner",
      fields: ["id", "tax_id", "tax_id_type"],
      filters: { id: partnerId },
    })
    return clean(partners?.[0]?.tax_id)
  } catch {
    // Best-effort: degrade to the platform fallback (no partner, un-migrated
    // column, query error). Never block the label.
    return null
  }
}

/**
 * Resolve the seller tax ID for an order: partner-own → platform-by-country →
 * undefined.
 */
export async function resolveSellerTaxIdForOrder(
  container: MedusaContainer,
  orderId: string | null | undefined,
  countryCode: string | null | undefined
): Promise<string | undefined> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  const own = await resolvePartnerOwnTaxId(container, query, orderId)
  if (own) {
    return own
  }

  const identities = await loadActiveIdentities(container)
  return resolvePlatformTaxIdString(countryCode, identities)
}

/**
 * Platform-only seller tax ID for a country (no partner/order context, e.g.
 * registering a Shiprocket pickup location). IN→JYT GSTIN, EU→KHT VAT.
 */
export async function resolvePlatformTaxIdForCountry(
  container: MedusaContainer,
  countryCode: string | null | undefined
): Promise<string | undefined> {
  const identities = await loadActiveIdentities(container)
  return resolvePlatformTaxIdString(countryCode, identities)
}
