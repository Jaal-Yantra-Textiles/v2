import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { ListEmailEditorProductsQuery } from "./validators"

/**
 * GET /admin/email-editor/products — #2349 S4, the Email tab's product picker.
 *
 * Published products of the house store (the store with no partner), because a
 * product card links to cicilabel.com. Read through the product↔sales-channel
 * link, NOT `/admin/products?sales_channel_id=`: with the index engine on, that
 * route answers from the index, which has returned a count with no rows (and
 * misses a product created moments ago).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { q, limit } = req.validatedQuery as ListEmailEditorProductsQuery

  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id", "metadata"],
  })
  const houseChannelIds = [
    ...new Set(
      (stores as any[])
        .filter((s) => !s.metadata?.partner_id && s.default_sales_channel_id)
        .map((s) => s.default_sales_channel_id as string)
    ),
  ]
  if (!houseChannelIds.length) {
    return res.json({ products: [], count: 0 })
  }

  const { data: links } = await query.graph({
    entity: "product_sales_channel",
    fields: ["product_id"],
    filters: { sales_channel_id: houseChannelIds },
  })
  const productIds = [...new Set((links as any[]).map((l) => l.product_id).filter(Boolean))]
  if (!productIds.length) {
    return res.json({ products: [], count: 0 })
  }

  const { data: products, metadata } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "title",
      "handle",
      "thumbnail",
      "images.url",
      "variants.id",
      "variants.prices.amount",
      "variants.prices.currency_code",
    ],
    filters: {
      id: productIds,
      status: "published",
      ...(q ? { title: { $ilike: `%${q}%` } } : {}),
    },
    pagination: { skip: 0, take: limit, order: { created_at: "DESC" } },
  })

  res.json({ products, count: metadata?.count ?? products.length })
}
