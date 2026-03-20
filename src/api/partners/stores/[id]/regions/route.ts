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

  if (!store.default_region_id) {
    return res.json({ regions: [], count: 0, offset: 0, limit: 20 })
  }

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
      "payment_providers.*",
    ],
    filters: { id: store.default_region_id },
  })

  res.json({
    regions: regions || [],
    count: regions?.length || 0,
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

  const { result } = await createRegionsWorkflow(req.scope).run({
    input: {
      regions: [body],
    },
  })

  const region = result[0]

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
