import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"
import { PartnerCreateRegionReq } from "../validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { getPartnerFromAuthContext } = await import("../../../helpers")
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)

  // Return regions belonging to this partner (tagged via metadata.partner_id)
  // plus the store's current default region if it exists
  const { data: allRegions } = await query.graph({
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

  // Filter to partner's own regions + the store's default region
  const regions = (allRegions || []).filter((r: any) => {
    const ownerId = r.metadata?.partner_id
    return ownerId === partner?.id || r.id === store.default_region_id
  })

  // Fetch payment providers linked to these regions
  const regionIds = (regions || []).map((r: any) => r.id)
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

  const enrichedRegions = (regions || []).map((r: any) => ({
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

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = PartnerCreateRegionReq.parse(req.body)
  const { payment_providers: paymentProviderIds, ...regionData } = body

  const { getPartnerFromAuthContext: getPartner } = await import("../../../helpers")
  const partner = await getPartner(req.auth_context, req.scope)

  const { result } = await createRegionsWorkflow(req.scope).run({
    input: {
      regions: [{
        ...regionData,
        metadata: {
          ...(regionData.metadata || {}),
          partner_id: partner?.id,
        },
      }],
    },
  })

  const region = result[0]

  // Link payment providers to the new region
  if (paymentProviderIds?.length) {
    const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
    await remoteLink.create(
      paymentProviderIds.map((providerId: string) => ({
        [Modules.REGION]: { region_id: region.id },
        [Modules.PAYMENT]: { payment_provider_id: providerId },
      }))
    )
  }

  // If the store doesn't have a default region yet, set it
  if (!store.default_region_id) {
    const storeService = req.scope.resolve(Modules.STORE)
    await (storeService as any).updateStores({
      id: store.id,
      default_region_id: region.id,
    })
  }

  res.status(201).json({ region })
}
