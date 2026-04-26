import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../../helpers"

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
  const option = await productService.createProductOptions({
    ...body,
    product_id: req.params.productId,
  })

  res.status(201).json({ product_option: option })
}
