/**
 * Turn the ids on a payout into things a human recognises (#1622).
 *
 * 🔴 Every payout screen currently renders raw ULIDs. `partner_id` on the
 * submission detail is the sharpest case: the one field naming WHO is being
 * paid renders as `01K4PJMNMNRGMK0ZXMKBBDZDGD`, so the page cannot be read
 * without a second lookup — and the reconciliation table repeats it per row.
 *
 * Best-effort, and per entity. A design that has since been deleted, or a link
 * that never synced, must leave that one name unresolved rather than blanking
 * the page: a payout is a record of money, and it has to render even when the
 * thing it paid for is gone. Callers fall back to the id.
 */

export type ResolvedRef = {
  id: string
  /** What to show. Never an id — a caller that gets no name shows the id itself. */
  name: string
  /** Extra context worth putting next to the name, if the entity has any. */
  detail?: string | null
}

export type ResolvedPaymentEntities = {
  partners: Map<string, ResolvedRef>
  designs: Map<string, ResolvedRef>
  runs: Map<string, ResolvedRef>
  orders: Map<string, ResolvedRef>
  inventoryOrders: Map<string, ResolvedRef>
}

const empty = (): ResolvedPaymentEntities => ({
  partners: new Map(),
  designs: new Map(),
  runs: new Map(),
  orders: new Map(),
  inventoryOrders: new Map(),
})

const uniq = (ids: (string | null | undefined)[]): string[] =>
  Array.from(new Set(ids.filter((id): id is string => !!id)))

/** One entity's lookup, isolated so a failure costs only that entity's names. */
const lookup = async (
  query: any,
  entity: string,
  ids: string[],
  fields: string[]
): Promise<any[]> => {
  if (!ids.length) return []
  try {
    const { data } = await query.graph({
      entity,
      fields,
      filters: { id: ids },
    })
    return (data || []) as any[]
  } catch {
    return []
  }
}

export const resolvePaymentEntities = async (
  query: any,
  input: {
    partnerIds?: (string | null | undefined)[]
    designIds?: (string | null | undefined)[]
    runIds?: (string | null | undefined)[]
    orderIds?: (string | null | undefined)[]
    inventoryOrderIds?: (string | null | undefined)[]
  }
): Promise<ResolvedPaymentEntities> => {
  if (!query) return empty()

  const [partners, designs, runs, orders, inventoryOrders] = await Promise.all([
    lookup(query, "partners", uniq(input.partnerIds || []), [
      "id",
      "name",
      "handle",
    ]),
    lookup(query, "designs", uniq(input.designIds || []), [
      "id",
      "name",
      "status",
    ]),
    lookup(query, "production_runs", uniq(input.runIds || []), [
      "id",
      "status",
      "quantity",
      "produced_quantity",
    ]),
    lookup(query, "order", uniq(input.orderIds || []), ["id", "display_id"]),
    lookup(query, "inventory_orders", uniq(input.inventoryOrderIds || []), [
      "id",
      "status",
      "total_price",
    ]),
  ])

  const out = empty()

  for (const p of partners) {
    out.partners.set(p.id, {
      id: p.id,
      name: p.name || p.handle || p.id,
      detail: p.handle || null,
    })
  }

  for (const d of designs) {
    out.designs.set(d.id, {
      id: d.id,
      name: d.name || d.id,
      detail: d.status || null,
    })
  }

  for (const r of runs) {
    /**
     * Produced, not ordered — a run that shipped 7 of 9 is paid for 7, and the
     * difference is the whole subject of #1596. Showing the ordered figure next
     * to a payout would explain the wrong number.
     */
    const produced = Number(r.produced_quantity)
    const ordered = Number(r.quantity)
    const made = Number.isFinite(produced) && produced > 0 ? produced : null

    out.runs.set(r.id, {
      id: r.id,
      name: `Run ${String(r.id).slice(-6)}`,
      detail: [
        r.status || null,
        made != null
          ? `${made} made${Number.isFinite(ordered) && ordered !== made ? ` of ${ordered}` : ""}`
          : Number.isFinite(ordered)
            ? `${ordered} ordered`
            : null,
      ]
        .filter(Boolean)
        .join(" · "),
    })
  }

  for (const o of orders) {
    out.orders.set(o.id, {
      id: o.id,
      name: o.display_id ? `Order #${o.display_id}` : `Order ${String(o.id).slice(-6)}`,
      detail: null,
    })
  }

  for (const io of inventoryOrders) {
    out.inventoryOrders.set(io.id, {
      id: io.id,
      name: `Inventory order ${String(io.id).slice(-6)}`,
      detail: io.status || null,
    })
  }

  return out
}

/** The ids a set of payout LINES refers to, ready for `resolvePaymentEntities`. */
export const collectLineRefs = (items: any[]) => ({
  designIds: (items || []).map((i) => i?.design_id),
  orderIds: (items || []).map((i) => i?.order_id),
  inventoryOrderIds: (items || []).map((i) => i?.inventory_order_id),
  runIds: (items || []).flatMap((i) => (i?.production_run_ids || []) as string[]),
})
