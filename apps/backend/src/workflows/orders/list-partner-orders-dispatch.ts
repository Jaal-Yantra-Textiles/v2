import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { resolveDesignThumbnail } from "../../lib/design-thumbnail"
import {
  listPartnerWorkOrderIds,
  listWorkOrdersPage,
  workOrderReadsEnabled,
} from "../../lib/work-orders/read-work-orders"
import {
  listPartnerOrdersWorkflow,
  type ListPartnerOrdersWorkflowInput,
} from "./list-partner-orders"

type Page = { orders: any[]; count: number; offset: number; limit: number }

/**
 * #2264 S2 — the partner orders list, reading work orders from `work_order`
 * when `WORK_ORDER_READS=true`.
 *
 * The single door for `GET /partners/orders` and its admin inspection mirror
 * `GET /admin/partners/:id/orders`, so the two cannot disagree about a list.
 *
 * - flag off, or `kind=retail`: the existing workflow, untouched.
 * - `kind=design|inventory`: this partner's work orders, superseded artifacts
 *   removed, filtered/sorted/paged in SQL on `work_order`.
 * - `kind=all`: retail from core ∪ work orders from `work_order`, merged in the
 *   requested order. Each source is read to `skip + take` so the merged page is
 *   exact; `count` is the sum.
 */
export async function listPartnerOrders(
  container: any,
  input: ListPartnerOrdersWorkflowInput
): Promise<Page> {
  if (!workOrderReadsEnabled() || input.kind === "retail" || !input.partnerId) {
    const { result } = await listPartnerOrdersWorkflow(container).run({ input })
    return result as Page
  }

  const ids = await listPartnerWorkOrderIds(container, input.partnerId)

  if (input.kind === "design" || input.kind === "inventory") {
    const page = await listWorkOrdersPage(container, {
      ids: ids[input.kind],
      baseFilters: input.baseFilters,
      order: input.order,
      skip: input.skip,
      take: input.take,
    })
    return {
      orders: await attachWorkOrderDesignSummaries(container, page.orders),
      count: page.count,
      offset: input.skip,
      limit: input.take,
    }
  }

  // kind=all
  const window = input.skip + input.take
  const { result: retail } = await listPartnerOrdersWorkflow(container).run({
    input: { ...input, kind: "retail", skip: 0, take: window },
  })
  const work = await listWorkOrdersPage(container, {
    ids: [...ids.design, ...ids.inventory],
    baseFilters: input.baseFilters,
    order: input.order,
    skip: 0,
    take: window,
  })
  const workRows = await attachWorkOrderDesignSummaries(container, work.orders)
  const merged = mergeByOrder(
    [...((retail as Page)?.orders ?? []), ...workRows],
    input.order
  ).slice(input.skip, input.skip + input.take)

  return {
    orders: merged,
    count: ((retail as Page)?.count ?? 0) + work.count,
    offset: input.skip,
    limit: input.take,
  }
}

/** PURE: sort rows from both sources by the requested order (newest first by default). */
export function mergeByOrder(
  rows: any[],
  order: Record<string, "ASC" | "DESC"> | undefined
): any[] {
  const [key, dir] = Object.entries(order ?? {})[0] ?? ["created_at", "DESC"]
  const val = (r: any) => {
    const v = r?.[key]
    if (v == null) return null
    const t = key.endsWith("_at") ? new Date(v).getTime() : v
    return typeof t === "number" && Number.isNaN(t) ? null : t
  }
  const sign = dir === "ASC" ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    if (x === y) return String(a?.id).localeCompare(String(b?.id))
    if (x == null) return 1
    if (y == null) return -1
    return (x < y ? -1 : 1) * sign
  })
}

/**
 * The `designs` summary the partner table shows beside a work order — read from
 * the typed `items[].design_id`, which a work-order line always carries, instead
 * of the mirror's run link + metadata fallback.
 */
export async function attachWorkOrderDesignSummaries(container: any, orders: any[]): Promise<any[]> {
  const idsByOrder = new Map<string, string[]>()
  const all = new Set<string>()
  for (const o of orders) {
    const ids = Array.from(
      new Set((o?.items ?? []).map((i: any) => i?.design_id).filter(Boolean))
    ) as string[]
    if (ids.length) {
      idsByOrder.set(o.id, ids)
      ids.forEach((id) => all.add(id))
    }
  }
  if (!all.size) return orders

  let designs: any[] = []
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "design",
      fields: ["id", "name", "media_files", "moodboard", "metadata"],
      filters: { id: [...all] },
    })
    designs = data ?? []
  } catch {
    // The table renders without pictures rather than failing the list.
    return orders
  }
  const byId = new Map(designs.map((d: any) => [String(d.id), d]))
  return orders.map((o) => {
    const summaries = (idsByOrder.get(o.id) ?? [])
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((d: any) => ({ id: String(d.id), name: d.name ?? null, thumbnail: resolveDesignThumbnail(d) }))
    return summaries.length ? { ...o, designs: summaries } : o
  })
}
