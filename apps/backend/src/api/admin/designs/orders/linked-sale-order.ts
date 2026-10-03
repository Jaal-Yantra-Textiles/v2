import designOrderLink from "../../../../links/design-order-link"

/**
 * Does this design have a linked order that is a SALE — the thing that makes a
 * design order "converted" (see `isConverted`)?
 *
 * 🔴 The design↔order link is also written for WORK ORDERS. Since #2306 a design
 * can be put into production before its buyer pays: the partner's work order
 * (e.g. #119, Sharlho stitching the Chupa shirt) links to the design, and every
 * design-order mutation then refused with "already converted" — the customer's
 * real order could never be raised, because the guard mistook the partner's
 * job for the customer's purchase.
 *
 * A work order is identified by its typed `work_order` row (same `order_` id),
 * never by metadata. Links to those are ignored; any other linked order still
 * counts, so a genuinely converted design order is refused exactly as before.
 *
 * A lookup failure answers "linked" — the guard's safe direction.
 */
export async function hasLinkedSaleOrder(query: any, designId: string): Promise<boolean> {
  try {
    const { data: links = [] } = await query.graph({
      entity: designOrderLink.entryPoint,
      filters: { design_id: designId },
      fields: ["order_id"],
    })
    const orderIds = Array.from(
      new Set((links as any[]).map((l) => l?.order_id).filter(Boolean).map(String))
    )
    if (!orderIds.length) return false

    const { data: workOrders = [] } = await query.graph({
      entity: "work_order",
      filters: { id: orderIds },
      fields: ["id"],
    })
    const workOrderIds = new Set((workOrders as any[]).map((w) => String(w.id)))
    return orderIds.some((id) => !workOrderIds.has(id))
  } catch {
    return true
  }
}
