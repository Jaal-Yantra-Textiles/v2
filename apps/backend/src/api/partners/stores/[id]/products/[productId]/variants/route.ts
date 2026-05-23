import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createProductVariantsWorkflow } from "@medusajs/medusa/core-flows"
import { remapVariantResponse } from "@medusajs/medusa/api/admin/products/helpers"
import {
  ensureInventoryLevelsForVariants,
  scopeAndAggregateVariantInventory,
  validatePartnerStoreAccess,
} from "../../../../../helpers"

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
  const { store } = await validatePartnerStoreAccess(
    req.auth_context,
    req.params.id,
    req.scope
  )

  const body = req.body as Record<string, any>

  // Use createProductVariantsWorkflow rather than the bare product service.
  // The workflow creates an empty price_set per variant (even with no prices)
  // and links variant ↔ price_set via createVariantPricingLinkStep — without
  // that link, admin's `/products/:id/prices` page crashes when it tries to
  // `variant.prices.reduce(...)` because the joined `prices` field comes back
  // as undefined for unlinked variants. Same workflow `batchProductVariantsWorkflow`
  // uses internally, so the behavior matches our batch route.
  const { result } = await createProductVariantsWorkflow(req.scope).run({
    input: {
      product_variants: [
        {
          ...body,
          product_id: req.params.productId,
        },
      ] as any,
    },
  })

  // The workflow returns the created variant with `prices` already populated
  // from the freshly-created price_set; just unwrap and return.
  const variant = result?.[0]

  // Auto-seed an inventory_level at the partner's stock location for
  // managed-inventory variants. The workflow creates the inventory item
  // and the variant ↔ item link, but NOT the level row — without that row
  // the partner-ui's inventory detail page 404s on this item.
  if (variant?.id) {
    await ensureInventoryLevelsForVariants(req.scope, store, [variant.id])
  }

  res.status(201).json({ variant })
}
