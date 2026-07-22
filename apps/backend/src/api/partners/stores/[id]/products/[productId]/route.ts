import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { deleteProductsWorkflow } from "@medusajs/medusa/core-flows"
import { remapProductResponse } from "@medusajs/medusa/api/admin/products/helpers"
import { scopeAndAggregateVariantInventory, validatePartnerStoreAccess } from "../../../../helpers"

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
  // Fetch prices via the price_set relation so we can reconstruct the flat
  // `rules` object from `price_rules` — the `prices.*` relation only returns
  // denormalized `rules_count`, which breaks region-scoped pricing in the UI.
  // `price_set.prices.fx_price_meta.*` pulls our 1:1 link rows so the UI
  // can render the FX badge + tooltip on auto-converted cells.
  const { data: products } = await query.graph({
    entity: "products",
    fields: [
      "*",
      "variants.*",
      "variants.price_set.prices.*",
      "variants.price_set.prices.price_rules.*",
      "variants.price_set.prices.fx_price_meta.*",
      "variants.options.*",
      "variants.inventory_items.*",
      "variants.inventory_items.inventory.*",
      "variants.inventory_items.inventory.location_levels.*",
      "options.*",
      "options.values.*",
      "images.*",
      "tags.*",
      "type.*",
      "collection.*",
      "sales_channels.*",
      // #1124 — provenance trail: the production runs that produced this
      // product's sold-and-fulfilled stock (product-as-spine link, #1112).
      "production_runs.id",
      "production_runs.status",
      "production_runs.order_id",
      "production_runs.design_id",
      "production_runs.partner_id",
      "production_runs.quantity",
      "production_runs.produced_quantity",
      "production_runs.created_at",
    ],
    filters: { id: req.params.productId },
  })

  if (!products?.[0]) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Product not found")
  }

  const product = products[0] as any

  // `remapVariantResponse` (used by remapProductResponse) flattens
  // `variant.price_set.prices` → `variant.prices` but only copies a
  // hand-picked subset of fields. Our `fx_price_meta` link rows are
  // not in that allow-list, so capture them by price.id before the
  // remap and re-attach to the flattened prices afterwards.
  const fxMetaByPriceId = new Map<string, any>()
  for (const variant of product.variants || []) {
    for (const price of variant.price_set?.prices || []) {
      if (price.fx_price_meta) {
        fxMetaByPriceId.set(price.id, price.fx_price_meta)
      }
    }
  }

  scopeAndAggregateVariantInventory(product.variants || [], store?.default_location_id)
  const remapped: any = remapProductResponse(product)
  // `remapProductResponse` only copies a hand-picked allow-list of relations,
  // so `production_runs` (like `fx_price_meta` above) is dropped — re-attach it.
  remapped.production_runs = product.production_runs || []
  if (fxMetaByPriceId.size) {
    for (const variant of remapped.variants || []) {
      for (const price of variant.prices || []) {
        const meta = fxMetaByPriceId.get(price.id)
        if (meta) price.fx_price_meta = meta
      }
    }
  }

  res.json({ product: remapped })
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
