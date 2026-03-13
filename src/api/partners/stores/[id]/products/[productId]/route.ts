import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "products",
    fields: [
      "*",
      "variants.*",
      "variants.prices.*",
      "variants.options.*",
      "variants.inventory_items.*",
      "options.*",
      "images.*",
      "tags.*",
      "type.*",
      "collection.*",
      "sales_channels.*",
    ],
    filters: { id: req.params.productId },
  })

  if (!products?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found")
  }

  res.json({ product: products[0] })
}

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
  const updated = await productService.updateProducts(req.params.productId, body)

  res.json({ product: updated })
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

  const productService = req.scope.resolve(Modules.PRODUCT) as any
  await productService.deleteProducts([req.params.productId])

  res.json({ id: req.params.productId, object: "product", deleted: true })
}
