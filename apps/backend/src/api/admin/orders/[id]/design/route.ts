import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import designOrderLink from "../../../../../links/design-order-link"
import designLineItemLink from "../../../../../links/design-line-item-link"
import { resolveLineItemDesignId } from "../../../../../lib/resolve-line-item-production"

export async function GET(
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
): Promise<void> {
  const orderId = req.params.id
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  /**
   * 🔴 The ORDER-level link is one source, not the only one.
   *
   * This route answered from `design_order` alone and returned
   * `{ design: null, designs: [] }` when it held no row — for an order whose
   * every line item resolves to a design through `product_design`. On prod,
   * order #101 (nine garments, deposit paid) reported NO designs while each of
   * its four lines pointed at a design-created product.
   *
   * That is not a cosmetic read. `produce_order_designs` names this route as
   * its preview and its own description says "call list_order_designs first",
   * so an operator checking before producing is told there is nothing to
   * produce — and nothing ever is. The produce path itself resolves through the
   * LINE ITEMS and would have worked; only the answer to "is there anything
   * here?" was wrong. A confident nothing is worse than an error.
   *
   * So both are read, and unioned: the order-level link (a commissioning order
   * can name a design that is on no line) and every line item, through the
   * canonical resolver the produce path uses — link → variant → product →
   * provenance string — so the read and the write agree by construction.
   */
  const { data: orderDesignLinks } = await query.graph({
    entity: designOrderLink.entryPoint,
    filters: { order_id: orderId },
    fields: ["design_id"],
  })

  /** design id -> the order line items it stands behind. */
  const lineItemsByDesign: Record<string, string[]> = {}
  const sourceByDesign: Record<string, string | null> = {}

  try {
    const { data: orders } = await query.graph({
      entity: "order",
      filters: { id: orderId },
      fields: [
        "id",
        "items.id",
        "items.variant_id",
        "items.product_id",
        "items.metadata",
      ],
    })
    const items: any[] = orders?.[0]?.items ?? []
    for (const item of items) {
      const resolved = await resolveLineItemDesignId(query, {
        productId: item?.product_id ?? null,
        variantId: item?.variant_id ?? null,
        lineItemId: item?.id ?? null,
        metadata: item?.metadata ?? null,
      }).catch(() => ({ designId: null, source: null } as any))

      if (!resolved?.designId) continue
      const key = String(resolved.designId)
      lineItemsByDesign[key] = [...(lineItemsByDesign[key] ?? []), String(item.id)]
      // First writer wins: the strongest rung that resolved this design.
      if (!(key in sourceByDesign)) sourceByDesign[key] = resolved.source ?? null
    }
  } catch {
    // An order we cannot read must not blank a widget the order-level link
    // could still answer.
  }

  const designIds = [
    ...new Set([
      ...(orderDesignLinks ?? []).map((link: any) => String(link.design_id)),
      ...Object.keys(lineItemsByDesign),
    ]),
  ].filter(Boolean)

  if (!designIds.length) {
    // Backwards-compatible: still return singular `design: null` + new `designs: []`
    res.status(200).json({ design: null, designs: [] })
    return
  }

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
    /**
     * The ORDER line items this design is actually on, and how it resolved.
     * Empty when the design is named by the order-level link alone — which is
     * exactly the case a caller must not send to production blindly.
     */
    order_line_item_ids: lineItemsByDesign[String(d.id)] ?? [],
    design_source: sourceByDesign[String(d.id)] ?? "order_link",
  }))

  res.status(200).json({
    // Backwards-compatible singular field
    design: withLinks[0] ?? null,
    designs: withLinks,
  })
}
