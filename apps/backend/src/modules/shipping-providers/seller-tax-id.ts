import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import partnerOrderLink from "../../links/partner-order"
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
 * Resolved via the module service rather than `query.graph` — the custom module
 * is not registered in the remote-query index, so a graph read returns nothing.
 */
async function loadActiveIdentities(
  container: MedusaContainer
): Promise<PlatformTaxIdentityRow[]> {
  try {
    const service: any = container.resolve(PLATFORM_TAX_IDENTITY_MODULE)
    // List all rows; the pure resolver skips inactive ones. (A boolean
    // `{ is_active: true }` filter resolved unreliably across container scopes.)
    const rows = await service.listPlatformTaxIdentities()
    return (rows ?? []) as PlatformTaxIdentityRow[]
  } catch {
    return []
  }
}

/** The order's partner's own tax ID, or null (best-effort, never throws). */
async function resolvePartnerOwnTaxId(
  query: any,
  orderId: string | null | undefined
): Promise<string | null> {
  if (!orderId) {
    return null
  }
  try {
    const { data: links } = await query.graph({
      entity: partnerOrderLink.entryPoint,
      fields: ["partner_id"],
      filters: { order_id: orderId },
    })
    const partnerId = links?.[0]?.partner_id
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
    // Best-effort: degrade to the platform fallback (no link, un-migrated column,
    // query error). Never block the label.
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

  const own = await resolvePartnerOwnTaxId(query, orderId)
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
