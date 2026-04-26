import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../helpers"
import { getPartnerFromAuthContext } from "../../../helpers"
import { PartnerCreateRegionReq } from "../validators"
import partnerRegionLink from "../../../../../links/partner-region"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get regions linked to this partner via the partner-region link table
  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { partner_id: partner!.id },
    fields: [
      "region_id",
      "region.*",
      "region.countries.*",
    ],
  })

  const regions = (links || [])
    .map((l: any) => l.region)
    .filter(Boolean)

  // Also include the store's default region if it's not already in the list
  if (store.default_region_id) {
    const hasDefault = regions.some((r: any) => r.id === store.default_region_id)
    if (!hasDefault) {
      const { data: defaultRegions } = await query.graph({
        entity: "region",
        fields: ["id", "name", "currency_code", "automatic_taxes", "metadata", "created_at", "updated_at", "countries.*"],
        filters: { id: store.default_region_id },
      })
      if (defaultRegions?.[0]) {
        regions.unshift(defaultRegions[0])
      }
    }
  }

  // Enrich with payment providers
  const regionIds = regions.map((r: any) => r.id)
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

  const enrichedRegions = regions.map((r: any) => ({
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

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const body = PartnerCreateRegionReq.parse(req.body)
  const { payment_providers: paymentProviderIds, ...regionData } = body

  const { result } = await createRegionsWorkflow(req.scope).run({
    input: {
      regions: [regionData],
    },
  })

  const region = result[0]

  // Link region to partner via the partner-region link
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    partner: { partner_id: partner!.id },
    [Modules.REGION]: { region_id: region.id },
  })

  // Link payment providers to the new region
  if (paymentProviderIds?.length) {
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
