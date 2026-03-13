import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
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
    entity: "regions",
    fields: ["*", "countries.*", "payment_providers.*"],
    filters: { id: regionId },
  })

  if (!regions?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Region not found")
  }

  res.json({ region: regions[0] })
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

  const regionService = req.scope.resolve(Modules.REGION) as any
  const updated = await regionService.updateRegions({
    id: regionId,
    ...body,
  })

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

  const regionService = req.scope.resolve(Modules.REGION) as any
  await regionService.deleteRegions([regionId])

  // Clear the store's default region
  const storeService = req.scope.resolve(Modules.STORE) as any
  await storeService.updateStores({
    id: store.id,
    default_region_id: null,
  })

  res.json({ id: regionId, object: "region", deleted: true })
}
