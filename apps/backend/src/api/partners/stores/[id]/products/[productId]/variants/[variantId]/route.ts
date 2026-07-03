import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
  deleteProductVariantsWorkflow,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows"
import { remapVariantResponse } from "@medusajs/medusa/api/admin/products/helpers"
import { scopeAndAggregateVariantInventory, validatePartnerStoreAccess } from "../../../../../../helpers"
import { fanoutVariantPrices } from "../../../../../../../../workflows/fx/fanout-variant-prices"

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
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  // Use updateProductVariantsWorkflow rather than the bare product service.
  // The bare service belongs to the product module and has no knowledge of
  // the pricing module — passing a `prices` field through it silently drops
  // the prices. The workflow looks up the variant's price_set link via
  // getVariantPricingLinkStep and updates prices through updatePriceSetsStep.
  //
  // Caveat: for variants created before this fix (via the old bare-service
  // create path), there is no price_set link to update. A backfill script
  // creates the missing links separately.
  const { result } = await updateProductVariantsWorkflow(req.scope).run({
    input: {
      product_variants: [
        {
          id: req.params.variantId,
          ...body,
        },
      ],
    },
  })

  const variant = result?.[0]

  // FX fanout — re-run so any changed/added price re-materialises the store's
  // other supported currencies. Idempotent (existing currencies are skipped) +
  // never throws.
  if (variant?.id) {
    await fanoutVariantPrices(req.scope, {
      storeId: store.id,
      variantIds: [variant.id],
    })
  }

  res.json({ variant })
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
