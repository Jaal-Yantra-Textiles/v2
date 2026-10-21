import designInventoryOrderLink from "../../../../../links/design-inventory-order"
import inventoryOrderItemsLink from "../../../../../links/inventory-orders-inventory-items"

export type StorySupplier = { id: string; name: string | null }

export type SupplierOrder = {
  id: string
  status?: string | null
  order_date?: string | Date | null
  created_at?: string | Date | null
  partner?: { id?: string | null; name?: string | null } | null
}

/**
 * Who supplied each fabric, from the purchase orders that bought it (#2442).
 *
 * The partner on an inventory order is the supplier: it is who the order is
 * sent to, and their portal's Complete is the dispatch. Nothing else records
 * it reliably — the design roster's `stage_role: supplier` is rarely set, and
 * an item's `metadata.supplier` is a blob anyone can overwrite.
 *
 * Per material: cancelled orders and orders with no partner never count; an
 * order attached to THIS design beats any other; then the most recent. No
 * order → no supplier, and the page says nothing rather than guess.
 */
export function pickMaterialSuppliers(input: {
  /** raw material id → ids of the orders that carried it */
  ordersByMaterial: Record<string, string[]>
  orders: SupplierOrder[]
  /** orders attached to this design (design ↔ inventory_order link) */
  designOrderIds: string[]
}): Record<string, StorySupplier> {
  const byId = new Map(input.orders.map((o) => [o.id, o]))
  const forDesign = new Set(input.designOrderIds)
  const when = (o: SupplierOrder) => String(o.order_date ?? o.created_at ?? "")

  const out: Record<string, StorySupplier> = {}
  for (const [materialId, orderIds] of Object.entries(input.ordersByMaterial)) {
    const candidates = Array.from(new Set(orderIds))
      .map((id) => byId.get(id))
      .filter(
        (o): o is SupplierOrder =>
          !!o && o.status !== "Cancelled" && !!o.partner?.id
      )
      .sort((a, b) => {
        const da = forDesign.has(a.id) ? 1 : 0
        const db = forDesign.has(b.id) ? 1 : 0
        if (da !== db) return db - da
        return when(b).localeCompare(when(a))
      })
    const top = candidates[0]
    if (top?.partner?.id) {
      out[materialId] = { id: top.partner.id, name: top.partner.name ?? null }
    }
  }
  return out
}

const toIso = (v: any): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : String(v)

/**
 * Load the orders behind a design's materials and pick a supplier for each.
 * A line names its material directly (`raw_material_id`, #817) or through its
 * inventory item; both are followed, so lines older than #817 still count.
 */
export async function loadMaterialSuppliers(
  query: any,
  input: {
    designId: string
    /** design inventory item id → raw material ids it carries */
    materialsByItem: Record<string, string[]>
  }
): Promise<Record<string, StorySupplier>> {
  const itemIds = Object.keys(input.materialsByItem)
  const materialIds = Array.from(new Set(Object.values(input.materialsByItem).flat()))
  if (!materialIds.length) return {}

  const { data: itemLinks } = await query
    .graph({
      entity: inventoryOrderItemsLink.entryPoint,
      filters: { inventory_item_id: itemIds },
      fields: ["inventory_order_line_id", "inventory_item_id"],
    })
    .catch(() => ({ data: [] }))
  const itemByLine = new Map<string, string>(
    (itemLinks ?? []).map((l: any) => [l.inventory_order_line_id, l.inventory_item_id])
  )

  const [{ data: linesByMaterial }, { data: linesByItem }] = await Promise.all([
    query.graph({
      entity: "inventory_order_line",
      filters: { raw_material_id: materialIds },
      fields: ["id", "raw_material_id", "inventory_orders.id"],
    }),
    itemByLine.size
      ? query.graph({
          entity: "inventory_order_line",
          filters: { id: Array.from(itemByLine.keys()) },
          fields: ["id", "raw_material_id", "inventory_orders.id"],
        })
      : Promise.resolve({ data: [] }),
  ])

  const ordersByMaterial: Record<string, string[]> = {}
  const add = (materialId: string, orderId?: string | null) => {
    if (!orderId || !materialIds.includes(materialId)) return
    ;(ordersByMaterial[materialId] ??= []).push(orderId)
  }
  for (const line of [...(linesByMaterial ?? []), ...(linesByItem ?? [])]) {
    const orderId = line?.inventory_orders?.id
    if (line?.raw_material_id) {
      add(line.raw_material_id, orderId)
    } else {
      const itemId = itemByLine.get(line?.id)
      for (const m of (itemId && input.materialsByItem[itemId]) || []) add(m, orderId)
    }
  }

  const orderIds = Array.from(new Set(Object.values(ordersByMaterial).flat()))
  if (!orderIds.length) return {}

  const [{ data: orders }, { data: designLinks }] = await Promise.all([
    query.graph({
      entity: "inventory_orders",
      filters: { id: orderIds },
      fields: ["id", "status", "order_date", "created_at", "partner.id", "partner.name"],
    }),
    query
      .graph({
        entity: designInventoryOrderLink.entryPoint,
        filters: { design_id: input.designId },
        fields: ["inventory_orders_id"],
      })
      .catch(() => ({ data: [] })),
  ])

  return pickMaterialSuppliers({
    ordersByMaterial,
    orders: (orders ?? []).map((o: any) => ({
      id: o.id,
      status: o.status,
      order_date: toIso(o.order_date),
      created_at: toIso(o.created_at),
      // One partner per order (partner ↔ inventory_orders is one-to-many).
      partner: Array.isArray(o.partner) ? null : o.partner,
    })),
    designOrderIds: (designLinks ?? []).map((l: any) => l.inventory_orders_id),
  })
}
