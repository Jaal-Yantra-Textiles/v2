import { getOrdersListWorkflow } from "@medusajs/core-flows"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { PARTNER_WORK_ORDERS_CHANNEL } from "../../workflows/inventory_orders/dual-write-unified-order"
import { mergeByOrder } from "../../workflows/orders/list-partner-orders-dispatch"
import { listWorkOrdersPage, workOrderFiltersCanMatch, type WorkOrderKind } from "./read-work-orders"

/**
 * #2264 S2b — the admin orders LIST with `WORK_ORDER_READS=true`.
 *
 *   retail           → core, minus every work order (see `workOrderIdsInCore`)
 *   design|inventory → `work_order` of that kind, filtered/sorted/paged in SQL
 *   all              → both, merged in the requested order
 *
 * Replaces the flag-off path's walk of every production run and inventory
 * order (1,000 rows a page) plus a scan of every order's metadata.
 *
 * Unlike the partner list, superseded run-split artifacts are NOT hidden: the
 * admin list never hid them, and the admin is who needs to see them.
 */

export type AdminOrderListKind = "retail" | "design" | "inventory" | "all"

type Page = { orders: any[]; count: number; offset: number; limit: number }

type Input = {
  kind: AdminOrderListKind
  /** `req.filterableFields` + `is_draft_order: false`, as the route builds it. */
  filters: Record<string, any>
  fields: string[]
  skip: number
  take: number
  order?: Record<string, "ASC" | "DESC">
}

const asIdList = (v: unknown): string[] | undefined => {
  if (v == null) return undefined
  if (typeof v === "string") return [v]
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === "object" && Array.isArray((v as any).$in)) return (v as any).$in.map(String)
  return undefined
}

/**
 * Every core order that is a work order, to keep out of RETAIL.
 *
 * Two sources, unioned:
 *   - `work_order` ids — the ids are carried over from the mirror (#2263), so
 *     this names every mirror the backfill copied, and keeps naming them after
 *     S5 deletes the mirror;
 *   - core orders in the internal "Partner Work Orders" sales channel — BOTH
 *     mirror writers put every mirror there (dual-write-unified-order.ts,
 *     dual-write-unified-run-order.ts). This catches a mirror the backfill
 *     skipped because its execution row is gone (`fromCoreOrder` returns null
 *     with no link), which the flag-off path caught by scanning every order's
 *     `metadata.legacy_id`.
 */
export async function workOrderIdsInCore(container: any): Promise<string[]> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const ids = new Set<string>()

  const { data: rows } = await query.graph({ entity: "work_order", fields: ["id"] })
  for (const r of rows ?? []) if (r?.id) ids.add(r.id)

  const scService: any = container.resolve(Modules.SALES_CHANNEL)
  const [channel] = await scService.listSalesChannels({ name: PARTNER_WORK_ORDERS_CHANNEL })
  if (channel) {
    const { data: mirrors } = await query.graph({
      entity: "order",
      fields: ["id"],
      filters: { sales_channel_id: channel.id },
    })
    for (const m of mirrors ?? []) if (m?.id) ids.add(m.id)
  }
  return [...ids]
}

async function listRetail(container: any, input: Input, skip: number, take: number) {
  const filters: Record<string, any> = { ...input.filters }
  const exclude = { $nin: await workOrderIdsInCore(container) }
  if (filters.id !== undefined) {
    const callerId = filters.id
    delete filters.id
    filters.$and = [...(filters.$and ?? []), { id: callerId }, { id: exclude }]
  } else {
    filters.id = exclude
  }
  // The merge in `kind=all` sorts on the order key, so it must be selected.
  const sortKeys = Object.keys(input.order ?? {})
  const fields = [...new Set([...(input.fields ?? []), ...sortKeys])]
  const { result } = await getOrdersListWorkflow(container).run({
    input: {
      fields,
      variables: { filters, skip, take, ...(input.order ? { order: input.order } : {}) },
    },
  })
  const { rows, metadata } = result as any
  return { orders: (rows ?? []) as any[], count: Number(metadata?.count ?? 0) }
}

async function listWork(
  container: any,
  input: Input,
  kind: WorkOrderKind | WorkOrderKind[],
  skip: number,
  take: number
) {
  if (!workOrderFiltersCanMatch(input.filters)) return { orders: [], count: 0 }
  return listWorkOrdersPage(container, {
    ids: asIdList(input.filters.id),
    kind,
    baseFilters: input.filters,
    order: input.order,
    skip,
    take,
  })
}

export async function listAdminOrders(container: any, input: Input): Promise<Page> {
  const page = (p: { orders: any[]; count: number }): Page => ({
    orders: p.orders,
    count: p.count,
    offset: input.skip,
    limit: input.take,
  })

  if (input.kind === "retail") {
    return page(await listRetail(container, input, input.skip, input.take))
  }
  if (input.kind === "design" || input.kind === "inventory") {
    return page(await listWork(container, input, input.kind, input.skip, input.take))
  }

  // kind=all — each source read to `skip + take` so the merged page is exact.
  // Both sources must be sorted by the SAME key for that to hold, so an
  // unsorted request is pinned to newest-first on both, not left to each
  // source's own default.
  const sorted: Input = { ...input, order: input.order ?? { created_at: "DESC" } }
  const window = input.skip + input.take
  const [retail, work] = await Promise.all([
    listRetail(container, sorted, 0, window),
    listWork(container, sorted, ["design", "inventory"], 0, window),
  ])
  return page({
    orders: mergeByOrder([...retail.orders, ...work.orders], sorted.order).slice(
      input.skip,
      input.skip + input.take
    ),
    count: retail.count + work.count,
  })
}
