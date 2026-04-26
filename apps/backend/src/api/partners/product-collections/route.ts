import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { createCollectionsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerStore, tryGetPartnerStore } from "../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await tryGetPartnerStore(req.auth_context, req.scope)
  if (!store) {
    return res.json({ collections: [], count: 0, offset: 0, limit: 20 })
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: storeData } = await query.graph({
    entity: "stores",
    fields: ["product_collections.id"],
    filters: { id: store.id },
  })

  const linkedIds = ((storeData?.[0] as any)?.product_collections || []).map(
    (c: any) => c.id
  )

  if (!linkedIds.length) {
    return res.json({ collections: [], count: 0, offset: 0, limit: 20 })
  }

  const { data: collections } = await query.graph({
    entity: "product_collection",
    fields: ["id", "title", "handle", "metadata", "created_at", "updated_at", "products.*"],
    filters: { id: linkedIds },
  })

  res.json({
    collections: collections || [],
    count: collections?.length || 0,
    offset: 0,
    limit: 20,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)

  const { result } = await createCollectionsWorkflow(req.scope).run({
    input: {
      collections: [req.body as any],
    },
  })

  const collection = result[0]

  // Link collection to store
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.create({
    [Modules.STORE]: { store_id: store.id },
    [Modules.PRODUCT]: { product_collection_id: collection.id },
  })

  res.status(201).json({ collection })
}
