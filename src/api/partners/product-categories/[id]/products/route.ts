import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { batchLinkProductsToCategoryWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerEntityOwnership } from "../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerEntityOwnership(
    req.auth_context,
    "product_categories",
    req.params.id,
    req.scope
  )

  const { add, remove } = req.body as { add?: string[]; remove?: string[] }

  await batchLinkProductsToCategoryWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      add,
      remove,
    },
  })

  res.json({ product_category: { id: req.params.id } })
}
