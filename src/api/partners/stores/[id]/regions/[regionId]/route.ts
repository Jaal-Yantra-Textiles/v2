import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteRegionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../helpers"
import { PartnerUpdateRegionReq } from "../../validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const regionId = req.params.regionId
  if (store.default_region_id !== regionId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Region not found for this store"
    )
  }

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
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const regionId = req.params.regionId
  if (store.default_region_id !== regionId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Region not found for this store"
    )
  }

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
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const regionId = req.params.regionId
  if (store.default_region_id !== regionId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Region not found for this store"
    )
  }

  await deleteRegionsWorkflow(req.scope).run({ input: { ids: [regionId] } })

  // Clear the store's default region
  const storeService = req.scope.resolve(Modules.STORE) as any
  await storeService.updateStores({
    id: store.id,
    default_region_id: null,
  })

  res.json({ id: regionId, object: "region", deleted: true })
}
