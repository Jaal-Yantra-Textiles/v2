import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designOrderLink from "../../../../../links/design-order-link"
import designLineItemLink from "../../../../../links/design-line-item-link"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const orderId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const { data: orderDesignLinks } = await query.graph({
    entity: designOrderLink.entryPoint,
    filters: { order_id: orderId },
    fields: ["design_id"],
  })

  if (!orderDesignLinks?.length) {
    // Backwards-compatible: still return singular `design: null` + new `designs: []`
    res.status(200).json({ design: null, designs: [] })
    return
  }

  const designIds = orderDesignLinks.map((link: any) => link.design_id)

  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: designIds },
    fields: ["id", "name", "status", "description", "thumbnail_url", "estimated_cost"],
  })

  const result = designs || []

  /**
   * The CART line item each design was commissioned on, so the order page can
   * deep-link to its design-order screen — which is where the lines are edited.
   *
   * That screen is keyed on a `cali_` cart line item, not on the order or the
   * design, so without this the widget can only offer "view design" and the
   * operator has to go hunting through the design-orders list.
   *
   * Best-effort and NULLABLE: the cart-level link dies at checkout for anything
   * created before it was kept, so a design with no row here simply gets no
   * link rather than a broken one.
   */
  const lineItemByDesign: Record<string, string> = {}
  try {
    const { data: itemLinks } = await query.graph({
      entity: designLineItemLink.entryPoint,
      filters: { design_id: designIds },
      fields: ["design_id", "line_item_id"],
    })
    for (const row of itemLinks || []) {
      if (row?.design_id && row?.line_item_id) {
        lineItemByDesign[String(row.design_id)] = String(row.line_item_id)
      }
    }
  } catch {
    // A missing link table must not take the whole widget down.
  }

  const withLinks = result.map((d: any) => ({
    ...d,
    design_order_line_item_id: lineItemByDesign[String(d.id)] ?? null,
  }))

  res.status(200).json({
    // Backwards-compatible singular field
    design: withLinks[0] ?? null,
    designs: withLinks,
  })
}
