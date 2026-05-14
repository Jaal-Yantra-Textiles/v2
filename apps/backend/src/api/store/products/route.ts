import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  FeatureFlag,
  QueryContext,
  isPresent,
} from "@medusajs/framework/utils"
import { wrapVariantsWithInventoryQuantityForSalesChannel } from "@medusajs/medusa/api/utils/middlewares/products/variant-inventory-quantity"
import { wrapProductsWithTaxPrices } from "@medusajs/medusa/api/store/products/helpers"

// Workaround for an upstream Medusa bug present in 2.14.x and 2.15.x: the
// /store/products route gates the index-engine path with
// `filterableFields.category_id` / `tag_id`, but the validator
// (transformProductParams) renames `category_id` -> `categories.id` (and
// tag_id -> tags.id) and deletes the original key before the route runs.
// The bypass therefore never fires for legitimate storefront requests like
// `?category_id[]=X`, which then hit the index engine — which doesn't index
// `product.categories` -> HTTP 500.
//
// This override restores the intended behavior: check both the original and
// post-transform key names. Index-engine optimization is preserved for all
// other queries.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const filterableFields = (req as any).filterableFields ?? {}

  const hasCategoryFilter =
    isPresent(filterableFields.categories) ||
    isPresent(filterableFields.category_id)
  const hasTagFilter =
    isPresent(filterableFields.tags) || isPresent(filterableFields.tag_id)

  const indexEngineEnabled = FeatureFlag.isFeatureEnabled("index_engine")

  if (indexEngineEnabled && !hasCategoryFilter && !hasTagFilter) {
    return await getProductsWithIndexEngine(req, res)
  }
  return await getProducts(req, res)
}

async function getProductsWithIndexEngine(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const context: Record<string, any> = {}
  const queryConfig = (req as any).queryConfig
  const pricingContext = (req as any).pricingContext

  const withInventoryQuantity = queryConfig.fields.some((field: string) =>
    field.includes("variants.inventory_quantity")
  )
  if (withInventoryQuantity) {
    queryConfig.fields = queryConfig.fields.filter(
      (field: string) => !field.includes("variants.inventory_quantity")
    )
  }

  if (isPresent(pricingContext)) {
    context["variants"] ??= {}
    context["variants"]["calculated_price"] ??= QueryContext(pricingContext)
  }

  const filters = { ...(req as any).filterableFields }
  if (isPresent(filters.sales_channel_id)) {
    const salesChannelIds = filters.sales_channel_id
    filters["sales_channels"] ??= {}
    filters["sales_channels"]["id"] = salesChannelIds
    delete filters.sales_channel_id
  }
  if (isPresent(filters.q)) {
    filters["variants"] ??= {}
  }

  const { data: products = [], metadata } = await (query as any).index(
    {
      entity: "product",
      fields: queryConfig.fields,
      filters,
      pagination: queryConfig.pagination,
      context,
    },
    {
      cache: { enable: true },
      locale: (req as any).locale,
    }
  )

  if (withInventoryQuantity) {
    await wrapVariantsWithInventoryQuantityForSalesChannel(
      req as any,
      products.map((p: any) => p.variants).flat(1)
    )
  }
  await wrapProductsWithTaxPrices(req as any, products)

  res.json({
    products,
    count: metadata.estimate_count,
    estimate_count: metadata.estimate_count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}

async function getProducts(req: MedusaRequest, res: MedusaResponse) {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const context: Record<string, any> = {}
  const queryConfig = (req as any).queryConfig
  const pricingContext = (req as any).pricingContext

  const withInventoryQuantity = queryConfig.fields.some((field: string) =>
    field.includes("variants.inventory_quantity")
  )
  if (withInventoryQuantity) {
    queryConfig.fields = queryConfig.fields.filter(
      (field: string) => !field.includes("variants.inventory_quantity")
    )
  }

  if (isPresent(pricingContext)) {
    context["variants"] ??= {}
    context["variants"]["calculated_price"] ??= QueryContext(pricingContext)
  }

  const { data: products = [], metadata } = await query.graph(
    {
      entity: "product",
      fields: queryConfig.fields,
      filters: (req as any).filterableFields,
      pagination: queryConfig.pagination,
      context,
    },
    {
      cache: { enable: true },
      locale: (req as any).locale,
    } as any
  )

  if (withInventoryQuantity) {
    await wrapVariantsWithInventoryQuantityForSalesChannel(
      req as any,
      products.map((p: any) => p.variants).flat(1)
    )
  }
  await wrapProductsWithTaxPrices(req as any, products)

  res.json({
    products,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  })
}
