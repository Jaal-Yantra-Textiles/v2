import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import partnerOrderLink from "../../links/partner-order"
import { toOrderShape, type WorkOrderRow } from "./to-order-shape"

/**
 * #2264 S2 — read work orders from `work_order`, not the core-order mirror.
 *
 * Behind `WORK_ORDER_READS=true`. With the flag off every caller keeps reading
 * the mirror exactly as before, so this can merge and deploy with no behaviour
 * change, and be flipped only after prod is compared on a sample.
 *
 * Every row leaves here through `toOrderShape`, the serializer the #2263 parity
 * job proved against the mirror (104/104 on 2026-09-24) — the UI sees the same
 * keys whichever table answered.
 */

export const workOrderReadsEnabled = (): boolean =>
  String(process.env.WORK_ORDER_READS ?? "").toLowerCase() === "true"

/** What a served work order needs: the row, its lines, its runs. */
export const WORK_ORDER_READ_FIELDS = ["*", "items.*", "production_runs.id"]

export type WorkOrderKind = "design" | "inventory"

/** A work order by id, or null — the caller falls back to core for anything else. */
export async function findWorkOrder(container: any, id: string): Promise<WorkOrderRow | null> {
  if (!id) return null
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "work_order",
    fields: WORK_ORDER_READ_FIELDS,
    filters: { id },
  })
  return (data?.[0] as WorkOrderRow) ?? null
}

/**
 * PURE: is this a canceled planning artifact a run split superseded (#2030)?
 *
 * The same rule `list-partner-orders` applies to the mirror, on the same two
 * sources OR'd: the typed `superseded_by_run_ids` column, and the typed split
 * (`childRunIds` — the run has children). A canceled order with neither is a
 * real cancellation and stays visible.
 */
export function isSupersededWorkOrder(
  wo: Pick<WorkOrderRow, "status" | "superseded_by_run_ids">,
  childRunIds?: string[]
): boolean {
  const status = String(wo?.status ?? "")
  if (status !== "canceled" && status !== "cancelled") return false
  if ((childRunIds ?? []).length > 0) return true
  return (wo?.superseded_by_run_ids ?? []).length > 0
}

/**
 * This partner's work-order ids by kind, superseded artifacts removed.
 *
 * 🔴 WHO a work order belongs to still comes from the D3 partner↔order link,
 * NOT `work_order.partner_id`. The link is `isList` on both sides — an order
 * can be linked to several partners — while the column holds one, filled from
 * `partnerLinks[0]` by the shadow sync. Listing by the column would hide a
 * shared order from every partner but one. The link is still written by the
 * dual-write until S5; before S5 deletes the mirror, work_order needs a
 * many-partner link of its own (#2261).
 */
export async function listPartnerWorkOrderIds(
  container: any,
  partnerId: string | null | undefined
): Promise<Record<WorkOrderKind, string[]>> {
  const out: Record<WorkOrderKind, string[]> = { design: [], inventory: [] }
  if (!partnerId) return out
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: links } = await query.graph({
    entity: partnerOrderLink.entryPoint,
    fields: ["order_id"],
    filters: { partner_id: partnerId },
  })
  const linkedIds = Array.from(
    new Set((links ?? []).map((l: any) => l?.order_id).filter(Boolean))
  ) as string[]
  if (!linkedIds.length) return out

  const { data: rows } = await query.graph({
    entity: "work_order",
    fields: ["id", "kind", "status", "superseded_by_run_ids", "production_runs.id"],
    filters: { id: linkedIds },
  })

  const canceledRunIds = (rows ?? [])
    .filter((r: any) => ["canceled", "cancelled"].includes(String(r?.status ?? "")))
    .flatMap((r: any) => (r?.production_runs ?? []).map((p: any) => p?.id))
    .filter(Boolean) as string[]

  const childrenByParent = new Map<string, string[]>()
  if (canceledRunIds.length) {
    const { data: children } = await query.graph({
      entity: "production_runs",
      fields: ["id", "parent_run_id"],
      filters: { parent_run_id: canceledRunIds },
    })
    for (const c of children ?? []) {
      const list = childrenByParent.get(c.parent_run_id) ?? []
      list.push(c.id)
      childrenByParent.set(c.parent_run_id, list)
    }
  }

  for (const r of rows ?? []) {
    const childIds = (r?.production_runs ?? []).flatMap(
      (p: any) => childrenByParent.get(p?.id) ?? []
    )
    if (isSupersededWorkOrder(r, childIds)) continue
    if (r.kind === "design" || r.kind === "inventory") out[r.kind as WorkOrderKind].push(r.id)
  }
  return out
}

/** Columns a work order can be sorted by; anything else sorts newest-first. */
const SORTABLE = new Set(["created_at", "updated_at", "display_id", "status"])

/** PURE: the core-order list filters, as `work_order` columns. */
export function toWorkOrderFilters(
  baseFilters: Record<string, any> | undefined
): { filters: Record<string, any>; q?: string } {
  const filters: Record<string, any> = {}
  let q: string | undefined
  for (const [key, value] of Object.entries(baseFilters ?? {})) {
    if (value == null) continue
    if (key === "q") q = String(value)
    else if (key === "status" || key === "created_at" || key === "updated_at") filters[key] = value
    // region_id / sales_channel_id are retail-only and never reach a work-order kind.
  }
  return { filters, q }
}

/** PURE: the list sort, as `work_order` columns. */
export function toWorkOrderOrder(
  order: Record<string, "ASC" | "DESC"> | undefined
): Record<string, "ASC" | "DESC"> {
  const out: Record<string, "ASC" | "DESC"> = {}
  for (const [key, dir] of Object.entries(order ?? {})) {
    if (SORTABLE.has(key)) out[key] = dir
  }
  return Object.keys(out).length ? out : { created_at: "DESC" }
}

/** One page of work orders, served in the core-order shape. */
export async function listWorkOrdersPage(
  container: any,
  input: {
    ids: string[]
    baseFilters?: Record<string, any>
    order?: Record<string, "ASC" | "DESC">
    skip: number
    take: number
  }
): Promise<{ orders: any[]; count: number }> {
  if (!input.ids.length) return { orders: [], count: 0 }
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const { filters, q } = toWorkOrderFilters(input.baseFilters)
  const { data, metadata } = await query.graph({
    entity: "work_order",
    fields: WORK_ORDER_READ_FIELDS,
    filters: { ...filters, id: input.ids, ...(q ? { q } : {}) },
    pagination: {
      skip: input.skip,
      take: input.take,
      order: toWorkOrderOrder(input.order),
    },
  })
  return {
    orders: (data ?? []).map((wo: WorkOrderRow) => toOrderShape(wo)),
    count: metadata?.count ?? (data ?? []).length,
  }
}
