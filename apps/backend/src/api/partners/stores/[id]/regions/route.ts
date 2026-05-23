import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Marketplace inheritance model: every partner sees ALL admin-curated
  // regions automatically. There is no per-partner subscription / picker
  // — admin defines the markets JYT serves, partners inherit all of them
  // on their storefronts.
  //
  // Why: when a customer from a country lands on a partner storefront,
  // Medusa's pricing/tax engine resolves their country → region. If the
  // partner hadn't "linked" to that region (in the older subscription
  // model), the customer saw no prices and couldn't check out. Inheriting
  // everything by default eliminates that footgun and matches Medusa's
  // marketplace recipe pattern (vendors share parent regions).
  //
  // The legacy `partner_region` link is intentionally NOT consulted here.
  // It still exists for backwards-compat data but no longer scopes
  // visibility. Per-partner customization (tax, payment credentials) lives
  // in the override modules — partner_tax_region (planned) and the
  // existing partner_payment_config — not in region row mutation.
  const { data: regions } = await query.graph({
    entity: "region",
    fields: [
      "id",
      "name",
      "currency_code",
      "automatic_taxes",
      "metadata",
      "created_at",
      "updated_at",
      "countries.*",
    ],
  })

  // Enrich with payment providers (admin's choice per region; partner
  // credentials are overlaid at runtime via partner_payment_config).
  const regionList = (regions || []) as any[]
  const regionIds = regionList.map((r) => r.id)
  let providersByRegion: Record<string, any[]> = {}
  if (regionIds.length > 0) {
    try {
      const { data: providerLinks } = await query.graph({
        entity: "region_payment_provider",
        filters: { region_id: regionIds },
        fields: ["region_id", "payment_provider.*"],
      })
      for (const link of providerLinks || []) {
        if (!providersByRegion[link.region_id]) {
          providersByRegion[link.region_id] = []
        }
        if (link.payment_provider) {
          providersByRegion[link.region_id].push(link.payment_provider)
        }
      }
    } catch {
      // Link may not exist
    }
  }

  const enrichedRegions = regionList.map((r) => ({
    ...r,
    payment_providers: providersByRegion[r.id] || [],
  }))

  res.json({
    regions: enrichedRegions,
    count: enrichedRegions.length,
    offset: 0,
    limit: 20,
  })
}

/**
 * POST is intentionally refused.
 *
 * Regions are admin-managed in the marketplace inheritance model — admin
 * curates the markets JYT serves; every partner storefront inherits all
 * of them automatically (see GET above). There's no per-partner region
 * creation because partners don't "own" regions; they operate within
 * the markets admin has set up.
 *
 * If a partner needs JYT to serve a new country, admin adds it via the
 * standard admin API and every partner immediately gains coverage.
 *
 * Per-partner customization that DOES make sense (tax rates per state,
 * payment-provider credentials per region) lives in override modules
 * — partner_tax_region (planned) and partner_payment_config (existing).
 */
export const POST = async (
  _req: AuthenticatedMedusaRequest,
  _res: MedusaResponse
) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Partners cannot create regions directly. Regions are admin-managed; contact admin to add support for a new country."
  )
}
