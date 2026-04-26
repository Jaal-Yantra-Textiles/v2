import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { deleteProductOptionsWorkflow } from "@medusajs/medusa/core-flows"
import { validatePartnerStoreAccess } from "../../../../../../helpers"

export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>
  const productService = req.scope.resolve(Modules.PRODUCT) as any
  const updated = await productService.updateProductOptions(
    req.params.optionId,
    body
  )

  res.json({ product_option: updated })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  await deleteProductOptionsWorkflow(req.scope).run({ input: { ids: [req.params.optionId] } })

  res.json({ id: req.params.optionId, object: "product_option", deleted: true })
}
