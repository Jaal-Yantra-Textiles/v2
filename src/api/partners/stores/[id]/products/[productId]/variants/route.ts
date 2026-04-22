import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { remapVariantResponse } from "@medusajs/medusa/api/admin/products/helpers"
import { scopeAndAggregateVariantInventory, validatePartnerStoreAccess } from "../../../../../helpers"

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
  const { data: products } = await query.graph({
    entity: "products",
    fields: [
      "variants.*",
      "variants.price_set.prices.*",
      "variants.price_set.prices.price_rules.*",
      "variants.options.*",
      "variants.inventory_items.*",
      "variants.inventory_items.inventory.*",
      "variants.inventory_items.inventory.location_levels.*",
    ],
    filters: { id: req.params.productId },
  })

  const rawVariants = (products?.[0]?.variants || []) as any[]
  scopeAndAggregateVariantInventory(rawVariants, store?.default_location_id)
  const variants = rawVariants.map((v: any) => remapVariantResponse(v))

  res.json({ variants, count: variants.length, offset: 0, limit: 20 })
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
  const variant = await productService.createProductVariants({
    ...body,
    product_id: req.params.productId,
  })

  res.status(201).json({ variant })
}
