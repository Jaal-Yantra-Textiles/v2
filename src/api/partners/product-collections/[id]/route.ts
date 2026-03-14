import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import {
  updateCollectionsWorkflow,
  deleteCollectionsWorkflow,
} from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "product_collections",
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "product_collections",
    fields: ["*", "products.*"],
    filters: { id: req.params.id },
  })

  res.json({ collection: data[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "product_collections",
    req.params.id,
    req.scope
  )

  const { result } = await updateCollectionsWorkflow(req.scope).run({
    input: {
      selector: { id: req.params.id },
      update: req.body as any,
    },
  })

  res.json({ collection: result[0] })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await validatePartnerEntityOwnership(
    req.auth_context,
    "product_collections",
    req.params.id,
    req.scope
  )

  // Dismiss the link first
  const remoteLink = req.scope.resolve(ContainerRegistrationKeys.LINK) as any
  await remoteLink.dismiss({
    [Modules.STORE]: { store_id: store.id },
    [Modules.PRODUCT]: { product_collection_id: req.params.id },
  })

  await deleteCollectionsWorkflow(req.scope).run({
    input: { ids: [req.params.id] },
  })

  res.status(200).json({ id: req.params.id, object: "product_collection", deleted: true })
}
