import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { batchLinkProductsToCollectionWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../../helpers"

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

  const { add, remove } = req.body as { add?: string[]; remove?: string[] }

  await batchLinkProductsToCollectionWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      add,
      remove,
    },
  })

  res.json({ collection: { id: req.params.id } })
}
