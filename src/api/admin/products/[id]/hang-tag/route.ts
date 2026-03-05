import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
const getStorefrontBase = () =>
  (process.env.NEXT_PUBLIC_STOREFRONT_URL || process.env.STOREFRONT_URL || "").replace(/\/$/, "")

/**
 * GET /admin/products/:id/hang-tag
 *
 * Returns JSON with all hang tag data for a product — the client renders the
 * printable PDF using pdf-lib + qrcode in the browser so we keep the response
 * light and avoid re-implementing QR generation server-side.
 *
 * Query params:
 *   format=pdf  — stream a ready-to-print PDF instead of JSON
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Fetch product with all linked entities
  const { data: products } = await query.graph({
    entity: "product",
    filters: { id },
    fields: [
      "id",
      "title",
      "handle",
      "description",
      "status",
      "thumbnail",
      "tags.*",
      "people.*",
      "designs.id",
      "designs.name",
      "designs.description",
      "designs.status",
      "designs.design_type",
      "designs.color_palette.*",
      "designs.tags",
      "designs.partners.id",
      "designs.partners.name",
      "designs.partners.people.id",
      "designs.partners.people.first_name",
      "designs.partners.people.last_name",
      "designs.partners.people.email",
    ],
  })

  const product = products?.[0]
  if (!product) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Product "${id}" not found`)
  }

  if (!product.handle) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Product has no handle — cannot generate hang tag URL"
    )
  }

  const storefrontUrl = `${getStorefrontBase()}/products/${product.handle}`

  res.json({
    product: {
      id: product.id,
      title: product.title,
      handle: product.handle,
      description: product.description,
      status: product.status,
      storefront_url: storefrontUrl,
      tags: (product as any).tags?.map((t: any) => t.value ?? t) ?? [],
      people: (product as any).people ?? [],
      designs: (product as any).designs ?? [],
    },
  })
}
