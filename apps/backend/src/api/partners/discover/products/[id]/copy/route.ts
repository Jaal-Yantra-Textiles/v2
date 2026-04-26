import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@medusajs/medusa/core-flows"
import { getPartnerStore } from "../../../../helpers"

/**
 * POST /partners/discover/products/:id/copy
 * Deep copies a product from another sales channel into the current partner's store.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { store } = await getPartnerStore(req.auth_context, req.scope)
  const salesChannelId = store.default_sales_channel_id

  if (!salesChannelId) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Store has no default sales channel"
    )
  }

  const sourceProductId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Fetch the source product with all details
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "*",
      "images.*",
      "options.*",
      "variants.*",
      "variants.prices.*",
      "variants.options.*",
      "type.*",
      "collection.*",
      "tags.*",
      "categories.*",
    ],
    filters: { id: sourceProductId },
  })

  const source = products?.[0] as any
  if (!source) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      "Source product not found"
    )
  }

  // Build the new product payload
  const uniqueSuffix = Date.now().toString(36)

  // Build options
  const options = (source.options || []).map((opt: any) => ({
    title: opt.title,
    values: opt.values?.map((v: any) => (typeof v === "string" ? v : v.value)) || [],
  }))

  // Build variants with prices and option values
  const variants = (source.variants || []).map((v: any) => {
    const optionValues: Record<string, string> = {}
    for (const vo of v.options || []) {
      if (vo.option?.title && vo.value) {
        optionValues[vo.option.title] = vo.value
      }
    }

    return {
      title: v.title,
      sku: v.sku ? `${v.sku}-${uniqueSuffix}` : undefined,
      barcode: v.barcode ? `${v.barcode}-${uniqueSuffix}` : undefined,
      ean: v.ean || undefined,
      upc: v.upc || undefined,
      allow_backorder: v.allow_backorder || false,
      manage_inventory: v.manage_inventory ?? true,
      weight: v.weight || undefined,
      length: v.length || undefined,
      height: v.height || undefined,
      width: v.width || undefined,
      origin_country: v.origin_country || undefined,
      material: v.material || undefined,
      metadata: v.metadata || undefined,
      options: optionValues,
      prices: (v.prices || [])
        .filter((p: any) => p.currency_code)
        .map((p: any) => ({
          amount: p.amount,
          currency_code: p.currency_code,
        })),
    }
  })

  // Build images
  const images = (source.images || []).map((img: any) => ({
    url: img.url,
  }))

  const newProductInput = {
    title: source.title,
    subtitle: source.subtitle || undefined,
    description: source.description || undefined,
    handle: `${source.handle}-${uniqueSuffix}`,
    status: "draft" as const,
    thumbnail: source.thumbnail || undefined,
    images,
    weight: source.weight || undefined,
    length: source.length || undefined,
    height: source.height || undefined,
    width: source.width || undefined,
    origin_country: source.origin_country || undefined,
    hs_code: source.hs_code || undefined,
    material: source.material || undefined,
    type_id: source.type?.id || undefined,
    collection_id: source.collection?.id || undefined,
    tags: (source.tags || []).map((t: any) => ({ id: t.id })),
    categories: (source.categories || []).map((c: any) => ({ id: c.id })),
    sales_channels: [{ id: salesChannelId }],
    options,
    variants,
    metadata: {
      ...(source.metadata || {}),
      copied_from: sourceProductId,
      copied_at: new Date().toISOString(),
    },
  }

  const { result } = await createProductsWorkflow(req.scope).run({
    input: {
      products: [newProductInput],
    },
  })

  const created = result[0]

  res.status(201).json({
    product: created,
    copied_from: sourceProductId,
  })
}
