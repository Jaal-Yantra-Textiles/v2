import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import partnerOrderLink from "../../links/partner-order"
import {
  getPlatformTaxIdConfig,
  resolveBrandForCountry,
  resolveTaxIdForCountry,
} from "../partner/tax-id-lib"

/**
 * Resolve the seller tax / GST / VAT registration ID to stamp on a carrier label
 * for an order (#348 slice B).
 *
 * Precedence (see modules/partner/tax-id-lib): the order's partner's OWN tax ID
 * wins; otherwise the platform fallback for the order / ship-from country
 * (IN→JYT GSTIN, EU→KHT VAT); otherwise none.
 *
 * I/O lives here (container + the partner↔order link); the precedence math is the
 * pure `resolveTaxIdForCountry`. The partner lookup is BEST-EFFORT — a missing
 * partner, an un-migrated `partner.tax_id` column (slice A / PR #652 not yet
 * merged), or any query error degrades to the platform fallback rather than
 * blocking label generation.
 *
 * @returns the tax ID string, or `undefined` when none applies.
 */
export async function resolveSellerTaxIdForOrder(
  container: MedusaContainer,
  orderId: string | null | undefined,
  countryCode: string | null | undefined
): Promise<string | undefined> {
  let partnerTaxId: string | null = null
  let partnerTaxIdType: string | null = null

  if (orderId) {
    try {
      const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: links } = await query.graph({
        entity: partnerOrderLink.entryPoint,
        fields: ["partner_id"],
        filters: { order_id: orderId },
      })
      const partnerId = links?.[0]?.partner_id
      if (partnerId) {
        const { data: partners } = await query.graph({
          entity: "partner",
          fields: ["id", "tax_id", "tax_id_type"],
          filters: { id: partnerId },
        })
        const partner = partners?.[0]
        partnerTaxId = partner?.tax_id ?? null
        partnerTaxIdType = partner?.tax_id_type ?? null
      }
    } catch {
      // Best-effort: degrade to the platform fallback (e.g. tax_id column not yet
      // migrated, no partner link, or query error). Never block the label.
    }
  }

  const resolved = resolveTaxIdForCountry({
    partnerTaxId,
    partnerTaxIdType,
    countryCode,
    config: getPlatformTaxIdConfig(),
  })
  return resolved.taxId || undefined
}

/**
 * Platform-only seller tax ID for a country (no partner/order context, e.g.
 * registering a Shiprocket pickup location). India→JYT GSTIN, EU→KHT VAT.
 */
export function resolvePlatformTaxIdForCountry(
  countryCode: string | null | undefined
): string | undefined {
  const brand = resolveBrandForCountry(countryCode)
  if (!brand) {
    return undefined
  }
  return getPlatformTaxIdConfig()[brand].taxId || undefined
}
