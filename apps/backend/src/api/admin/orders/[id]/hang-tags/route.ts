import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

export type OrderHangTagLine = {
  line_item_id: string
  product_id: string | null
  product_handle: string | null
  title: string | null
  variant_title: string | null
  /** One printed tag per unit. */
  quantity: number
}

/**
 * GET /admin/orders/:id/hang-tags (#2541)
 *
 * The pieces in an order, one entry per line, so the admin can print a tag per
 * piece. Each product's tag content (design, story) comes from
 * `GET /admin/products/:id/hang-tag`; this route only says what to print and
 * how many. Lines with no product (custom items) are returned with
 * `product_id: null` so the UI can say why they get no tag.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data: orders } = await query.graph({
    entity: "order",
    filters: { id: req.params.id },
    fields: [
      "id",
      "display_id",
      "customer.first_name",
      "customer.last_name",
      "customer.company_name",
      "items.id",
      "items.title",
      "items.variant_title",
      "items.quantity",
      "items.product_id",
      "items.product_handle",
    ],
  })

  const order = orders?.[0] as any
  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Order "${req.params.id}" not found`)
  }

  const lines: OrderHangTagLine[] = (order.items ?? [])
    .map((i: any) => ({
      line_item_id: i.id,
      product_id: i.product_id ?? null,
      product_handle: i.product_handle ?? null,
      title: i.title ?? null,
      variant_title: i.variant_title ?? null,
      quantity: Math.max(0, Math.round(Number(i.quantity ?? 0))),
    }))
    .filter((l: OrderHangTagLine) => l.quantity > 0)

  res.json({
    order: {
      id: order.id,
      display_id: order.display_id ?? null,
      customer_name:
        order.customer?.company_name ||
        [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(" ") ||
        null,
    },
    lines,
    tag_count: lines.reduce((n, l) => n + (l.product_id ? l.quantity : 0), 0),
  })
}
