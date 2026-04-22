import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteProductsWorkflow } from "@medusajs/medusa/core-flows"
import { remapProductResponse } from "@medusajs/medusa/api/admin/products/helpers"
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
  // Fetch prices via the price_set relation so we can reconstruct the flat
  // `rules` object from `price_rules` — the `prices.*` relation only returns
  // denormalized `rules_count`, which breaks region-scoped pricing in the UI.
  const { data: products } = await query.graph({
    entity: "products",
    fields: [
      "*",
      "variants.*",
      "variants.price_set.prices.*",
      "variants.price_set.prices.price_rules.*",
      "variants.options.*",
      "variants.inventory_items.*",
      "options.*",
      "options.values.*",
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

  res.json({ product: remapProductResponse(products[0] as any) })
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

  // Use the workflow instead of direct service call so that
  // sales channel links, index engine entries, and remote links
  // are all properly cleaned up
  await deleteProductsWorkflow(req.scope).run({
    input: { ids: [req.params.productId] },
  })

  res.json({ id: req.params.productId, object: "product", deleted: true })
}
