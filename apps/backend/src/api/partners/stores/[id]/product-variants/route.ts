import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { validatePartnerStoreAccess } from "../../../helpers"

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

  // Get products via sales channel, then get their variants
  if (!store.default_sales_channel_id) {
    return res.json({ variants: [], count: 0, offset: 0, limit: 20 })
  }

  const { data: scData } = await query.graph({
    entity: "sales_channel",
    fields: [
      "products_link.product.variants.*",
      "products_link.product.variants.prices.*",
      "products_link.product.variants.options.*",
      "products_link.product.id",
      "products_link.product.title",
      "products_link.product.thumbnail",
    ],
    filters: { id: store.default_sales_channel_id },
  })

  const sc = scData?.[0] as any
  const variants: any[] = []

  for (const link of (sc?.products_link || [])) {
    const product = link?.product
    if (product?.variants) {
      for (const v of product.variants) {
        variants.push({
          ...v,
          product_id: product.id,
          product: {
            id: product.id,
            title: product.title,
            thumbnail: product.thumbnail,
          },
        })
      }
    }
  }

  // Apply query filters if provided
  const qId = req.query.id
  let filtered = variants
  if (qId) {
    const ids = Array.isArray(qId) ? qId : [qId]
    filtered = variants.filter((v) => ids.includes(v.id))
  }

  const q = (req.query.q as string) || ""
  if (q) {
    const lower = q.toLowerCase()
    filtered = filtered.filter(
      (v) =>
        v.title?.toLowerCase().includes(lower) ||
        v.sku?.toLowerCase().includes(lower) ||
        v.product?.title?.toLowerCase().includes(lower)
    )
  }

  res.json({
    variants: filtered,
    count: filtered.length,
    offset: 0,
    limit: filtered.length,
  })
}
