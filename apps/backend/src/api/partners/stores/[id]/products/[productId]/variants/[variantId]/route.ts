import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { remapVariantResponse } from "@medusajs/medusa/api/admin/products/helpers"
import { scopeAndAggregateVariantInventory, validatePartnerStoreAccess } from "../../../../../../helpers"

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

  const { data: variants } = await query.graph({
    entity: "product_variants",
    fields: [
      "*",
      "product_id",
      "price_set.prices.*",
      "price_set.prices.price_rules.*",
      "options.*",
      "options.option.*",
      "inventory_items.*",
      // Nested inventory relations are required for the partner variant
      // detail page: row click navigates to `/inventory/${inventory.id}` and
      // stock availability renders from `inventory.location_levels`. Without
      // these, `i.inventory` is undefined → /inventory/undefined → 404.
      "inventory_items.inventory.*",
      "inventory_items.inventory.location_levels.*",
      // Images: the variant media edit page (/products/:id/variants/:vid/media)
      // needs both the variant-scoped images AND the full product image pool
      // so users can associate existing product images with this variant.
      // Each image's `variants.id` is required to tell the form which
      // images are already linked to the variant.
      "product.*",
      "product.images.*",
      "product.images.variants.id",
      "images.*",
      "images.variants.id",
    ],
    filters: { id: req.params.variantId },
  })

  if (!variants?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Variant not found")
  }

  // Partner-scope inventory and populate aggregate quantities before remap.
  scopeAndAggregateVariantInventory([variants[0]] as any[], store?.default_location_id)
  const variant = remapVariantResponse(variants[0] as any) as any

  if (!variant.product_id) {
    variant.product_id = req.params.productId
  }

  res.json({ variant })
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
  const updated = await productService.updateProductVariants(
    req.params.variantId,
    body
  )

  res.json({ variant: updated })
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

  await deleteProductVariantsWorkflow(req.scope).run({ input: { ids: [req.params.variantId] } })

  res.json({ id: req.params.variantId, object: "product_variant", deleted: true })
}
