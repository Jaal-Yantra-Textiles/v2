import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { validatePartnerOrderOwnership } from "../../../helpers"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await validatePartnerOrderOwnership(req.auth_context, req.params.id, req.scope)

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "order",
    // `relation.*` not `*relation` — the asterisk-prefix form has tripped
    // MikroORM on several entities. Admin uses the suffix form.
    fields: [
      "items.*",
      "items.variant.*",
      "items.variant.product.*",
      "items.variant.product.images.url",
      "items.variant.product.images.rank",
    ],
    filters: { id: req.params.id },
  })

  const items = (data?.[0] as any)?.items || []

  // Backfill the order-time snapshot `thumbnail` when it's missing so
  // `item.thumbnail` is always populated for the UI. Medusa only ever copies the
  // product ROOT thumbnail onto the line item at cart time, so a product with
  // only `images` (no root thumbnail) leaves the snapshot null — fall back to the
  // first image. The product is already fetched, so no extra query.
  for (const it of items) {
    if (!it?.thumbnail) {
      const product = it?.variant?.product
      const firstImage = (product?.images ?? [])
        .slice()
        .sort((a: any, b: any) => (a?.rank ?? 0) - (b?.rank ?? 0))[0]?.url
      const fallback = product?.thumbnail || firstImage
      if (fallback) {
        it.thumbnail = fallback
      }
    }
  }

  res.json({ order_items: items })
}
