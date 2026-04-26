import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess, getPartnerFromAuthContext } from "../../../../helpers"
import { PartnerUpdateRegionReq } from "../../validators"
import partnerRegionLink from "../../../../../../links/partner-region"

async function verifyRegionOwnership(req: AuthenticatedMedusaRequest) {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  const regionId = req.params.regionId
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Check if region is linked to this partner
  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { partner_id: partner!.id, region_id: regionId },
    fields: ["region_id"],
  })

  // Also allow access if it's the store's default region (for backwards compatibility)
  if (!links?.length && store.default_region_id !== regionId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Region not found for this partner"
    )
  }

  return { store, partner, regionId }
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { regionId } = await verifyRegionOwnership(req)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
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
    filters: { id: regionId },
  })

  if (!regions?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Region not found")
  }

  // Fetch payment providers linked to this region
  let paymentProviders: any[] = []
  try {
    const { data: providerLinks } = await query.graph({
      entity: "region_payment_provider",
      filters: { region_id: regionId },
      fields: ["payment_provider.*"],
    })
    paymentProviders = (providerLinks || [])
      .map((l: any) => l.payment_provider)
      .filter(Boolean)
  } catch {
    // Link may not exist
  }

  res.json({ region: { ...regions[0], payment_providers: paymentProviders } })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { regionId } = await verifyRegionOwnership(req)

  const body = PartnerUpdateRegionReq.parse(req.body)
  const { payment_providers: paymentProviderIds, ...regionData } = body

  const regionService = req.scope.resolve(Modules.REGION) as any
  const updated = await regionService.updateRegions({
    id: regionId,
    ...regionData,
  })

  // Handle payment provider linking separately if provided
  if (paymentProviderIds) {
    const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
    // Remove existing payment provider links
    try {
      const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
      const { data: existingLinks } = await query.graph({
        entity: "region_payment_provider",
        filters: { region_id: regionId },
        fields: ["payment_provider_id"],
      })
      if (existingLinks?.length) {
        await remoteLink.dismiss(
          existingLinks.map((l: any) => ({
            [Modules.REGION]: { region_id: regionId },
            [Modules.PAYMENT]: { payment_provider_id: l.payment_provider_id },
          }))
        )
      }
    } catch {
      // No existing links
    }
    // Create new links
    if (paymentProviderIds.length > 0) {
      await remoteLink.create(
        paymentProviderIds.map((providerId: string) => ({
          [Modules.REGION]: { region_id: regionId },
          [Modules.PAYMENT]: { payment_provider_id: providerId },
        }))
      )
    }
  }

  res.json({ region: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store, partner, regionId } = await verifyRegionOwnership(req)

  // Remove the partner-region link
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  try {
    await remoteLink.dismiss({
      partner: { partner_id: partner!.id },
      [Modules.REGION]: { region_id: regionId },
    })
  } catch {
    // Link may not exist
  }

  await deleteRegionsWorkflow(req.scope).run({ input: { ids: [regionId] } })

  // Clear the store's default region if it was the deleted one
  if (store.default_region_id === regionId) {
    const storeService = req.scope.resolve(Modules.STORE) as any
    await storeService.updateStores({
      id: store.id,
      default_region_id: null,
    })
  }

  res.json({ id: regionId, object: "region", deleted: true })
}
