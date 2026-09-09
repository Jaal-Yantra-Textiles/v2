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

  /**
   * 🔴 The LINE ITEMS win when they have an opinion.
   *
   * Unioning both sources blindly is wrong on a re-pointed order. Prod order #3
   * has five `design_order` rows naming what was ORIGINALLY commissioned — three
   * of those designs are now `Superseded` — plus three lines re-pointed to new
   * designs. A union lists eight designs for a five-line order, three of them
   * no longer being made, and the widget cannot tell them apart.
   *
   * So `designs` is what the order stands for NOW, and an order-level design
   * that no line resolves to is returned separately as `unlinked_designs`
   * rather than silently dropped: it is what was commissioned, and losing that
   * is the provenance #1919 exists to keep. When no line resolves at all — a
   * commissioning order with title-only items — the order-level link is the
   * only answer there is, so it becomes the answer.
   */
  const fromLines = Object.keys(lineItemsByDesign)
  const fromOrderLink: string[] = [
    ...new Set(
      (orderDesignLinks ?? []).map((link: any) => String(link.design_id))
    ),
  ].filter((id): id is string => Boolean(id))

  const designIds = fromLines.length ? fromLines : fromOrderLink
  const unlinkedIds = fromLines.length
    ? fromOrderLink.filter((id) => !lineItemsByDesign[id])
    : []

  if (!designIds.length && !unlinkedIds.length) {
    // Backwards-compatible: still return singular `design: null` + new `designs: []`
    res.status(200).json({ design: null, designs: [] })
    return
  }

  const designFields = [
    "id",
    "name",
    "status",
    "description",
    "thumbnail_url",
    "estimated_cost",
  ]
  const { data: designs } = await query.graph({
    entity: "design",
    filters: { id: [...designIds, ...unlinkedIds] },
    fields: designFields,
  })

  const byId: Record<string, any> = {}
  for (const d of designs || []) byId[String(d.id)] = d
  const result = designIds.map((id) => byId[id]).filter(Boolean)

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
    /**
     * Named by the order-level link, on no line any more — what was
     * commissioned before a re-point. Kept out of `designs` so the widget shows
     * the order as it stands, and returned so the history is not lost.
     */
    unlinked_designs: unlinkedIds
      .map((id) => byId[id])
      .filter(Boolean)
      .map((d: any) => ({
        ...d,
        design_order_line_item_id: lineItemByDesign[String(d.id)] ?? null,
        order_line_item_ids: [],
        design_source: "order_link",
      })),
  })
}
