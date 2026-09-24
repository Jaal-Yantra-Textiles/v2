import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import partnerOrderLink from "../../links/partner-order"
import { PRODUCTION_RUNS_MODULE } from "../../modules/production_runs"
import { WORK_ORDER_MODULE } from "../../modules/work_orders"
import { WORK_ORDER_MIRROR_FIELDS, fromCoreOrder } from "./from-core-order"

/**
 * #2263 S1 — make the `work_order` for one #342 mirror match the mirror.
 *
 * ONE idempotent function, used two ways:
 *   - the SHADOW WRITE: every mirror writer calls it (via `shadowSyncWorkOrder`)
 *     after it has written the core order, so the new table follows along;
 *   - the BACKFILL / RESYNC job: run over every mirror. It also repairs any
 *     mirror change that bypassed the writers (e.g. a cancel through the core
 *     order route).
 *
 * Upsert, never append:
 *   - the work_order is created with the mirror's id, display_id and created_at
 *     (so the number and date the partner sees do not change), else updated;
 *   - lines are matched by id — created, updated, or DELETED when the mirror
 *     dropped them (an inventory line edit, #2172);
 *   - work_order ↔ production_runs links are reconciled to the mirror's
 *     order ↔ production_runs links, both ways.
 *
 * Nothing READS the table until S2 (#2264), so a failure here is logged, never
 * thrown into the business workflow — `work-order-parity` reports drift.
 */

export type SyncOutcome =
  | { status: "created" | "updated"; order_id: string }
  | { status: "skipped"; order_id: string; reason: "no_mirror" | "not_a_work_order" }

const HEADER_FIELDS = [
  "kind",
  "collation",
  "status",
  "partner_status",
  "partner_id",
  "currency_code",
  "inventory_order_id",
  "source_order_id",
  "canceled_at",
  "superseded_by_run_ids",
] as const

const ITEM_FIELDS = [
  "title",
  "subtitle",
  "thumbnail",
  "quantity",
  "unit_price",
  "design_id",
  "production_run_id",
  "inventory_order_line_id",
] as const

const pick = <T extends Record<string, any>>(row: T, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, row[k] ?? null]))

export const syncWorkOrderFromMirror = async (
  container: any,
  orderId: string
): Promise<SyncOutcome> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const service: any = container.resolve(WORK_ORDER_MODULE)

  const { data: mirrors } = await query.graph({
    entity: "order",
    fields: WORK_ORDER_MIRROR_FIELDS,
    filters: { id: orderId },
  })
  const mirror = mirrors?.[0]
  if (!mirror) {
    return { status: "skipped", order_id: orderId, reason: "no_mirror" }
  }

  const { data: partnerLinks } = await query.graph({
    entity: partnerOrderLink.entryPoint,
    fields: ["partner_id"],
    filters: { order_id: orderId },
  })
  const row = fromCoreOrder(mirror, partnerLinks?.[0]?.partner_id ?? null)
  if (!row) {
    return { status: "skipped", order_id: orderId, reason: "not_a_work_order" }
  }

  // --- header ---
  const [existing] = await service.listWorkOrders({ id: row.id }, { relations: ["items"] })
  const header = pick(row, HEADER_FIELDS)
  if (!existing) {
    await service.createWorkOrders({
      id: row.id,
      display_id: row.display_id,
      created_at: row.created_at,
      ...header,
    })
  } else {
    await service.updateWorkOrders({ id: row.id, ...header })
  }

  // --- lines, matched by id ---
  const current = new Map<string, any>((existing?.items ?? []).map((it: any) => [it.id, it]))
  const wanted = row.items ?? []
  const toCreate = wanted.filter((it) => !current.has(it.id))
  const toUpdate = wanted.filter((it) => current.has(it.id))
  const wantedIds = new Set(wanted.map((it) => it.id))
  const toDelete = [...current.keys()].filter((id) => !wantedIds.has(id))

  if (toCreate.length) {
    await service.createWorkOrderItems(
      toCreate.map((it) => ({
        id: it.id,
        created_at: it.created_at,
        work_order_id: row.id,
        ...pick(it, ITEM_FIELDS),
      }))
    )
  }
  if (toUpdate.length) {
    await service.updateWorkOrderItems(
      toUpdate.map((it) => ({ id: it.id, ...pick(it, ITEM_FIELDS) }))
    )
  }
  if (toDelete.length) {
    await service.deleteWorkOrderItems(toDelete)
  }

  // --- work_order ↔ production_runs, reconciled to the mirror's links ---
  const { data: linked } = await query.graph({
    entity: "work_order",
    fields: ["id", "production_runs.id"],
    filters: { id: row.id },
  })
  const have = new Set<string>(
    (linked?.[0]?.production_runs ?? []).map((r: any) => r?.id).filter(Boolean)
  )
  const want = new Set<string>((row.production_runs ?? []).map((r) => r.id))
  const link: any = container.resolve(ContainerRegistrationKeys.LINK)
  const def = (runId: string) => ({
    [WORK_ORDER_MODULE]: { work_order_id: row.id },
    [PRODUCTION_RUNS_MODULE]: { production_runs_id: runId },
  })
  const add = [...want].filter((id) => !have.has(id))
  const drop = [...have].filter((id) => !want.has(id))
  if (add.length) await link.create(add.map(def))
  if (drop.length) await link.dismiss(drop.map(def))

  return { status: existing ? "updated" : "created", order_id: row.id }
}

/**
 * The shadow write the mirror writers call. Best-effort by design: the new
 * table is not read yet, and a business workflow must never fail because its
 * shadow did. Accepts a null id so a caller can pass "whatever I produced".
 */
export const shadowSyncWorkOrder = async (
  container: any,
  orderId: string | null | undefined,
  source: string
): Promise<void> => {
  if (!orderId) return
  try {
    await syncWorkOrderFromMirror(container, orderId)
  } catch (e: any) {
    try {
      container
        .resolve(ContainerRegistrationKeys.LOGGER)
        .warn(`[work-orders] shadow sync failed after ${source} for ${orderId}: ${e?.message}`)
    } catch {
      // no logger — nothing else to do; the parity job will report the drift
    }
  }
}
