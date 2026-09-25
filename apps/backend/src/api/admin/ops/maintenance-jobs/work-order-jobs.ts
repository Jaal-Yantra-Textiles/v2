import { isDeepStrictEqual } from "node:util"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { collectWorkOrderIds } from "../../orders/route"
import { workOrderIdsInCore } from "../../../../lib/work-orders/admin-order-reads"
import { WORK_ORDER_MIRROR_FIELDS } from "../../../../lib/work-orders/from-core-order"
import { WORK_ORDER_READ_FIELDS } from "../../../../lib/work-orders/read-work-orders"
import { syncWorkOrderFromMirror } from "../../../../lib/work-orders/sync-from-mirror"
import { toOrderShape } from "../../../../lib/work-orders/to-order-shape"
import { pickWorkOrderContract } from "../../../../lib/work-orders/work-order-contract"
import { WORK_ORDER_MODULE } from "../../../../modules/work_orders"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

/**
 * #2263 S1 — the jobs that fill and check `work_order` (#2261).
 *
 *   backfill-work-orders — copy / resync every #342 mirror into work_order
 *   work-order-parity    — read-only: does each work_order read to the UI
 *                          exactly as its mirror does, and do the admin lists
 *                          hold the same orders from either source?
 */

const MAX_SCAN = 5000
const CHUNK = 100

const idsParam = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    (Array.isArray(v) ? v : String(v ?? "").split(","))
      .map((s) => s.trim())
      .filter(Boolean)
  )

const chunks = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/**
 * Every core order that IS a work order: it has an order↔production_run or an
 * order↔inventory_order link. Read from the execution side (the link is
 * authoritative; query.graph, not the index). A `legacy_id`-only orphan has no
 * link and is deliberately NOT selected — its kind cannot be proven.
 */
export const listMirrorOrderIds = async (container: any): Promise<string[]> => {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const ids = new Set<string>()
  for (const entity of ["production_runs", "inventory_orders"]) {
    const { data } = await query.graph({
      entity,
      fields: ["id", "order.id"],
      pagination: { take: MAX_SCAN },
    })
    for (const row of data ?? []) {
      if (row?.order?.id) ids.add(row.order.id)
    }
  }
  return [...ids].sort()
}

export const backfillWorkOrdersJob: MaintenanceJob = {
  id: "backfill-work-orders",
  label: "Backfill work orders from the core-order mirror",
  description:
    `#2263 S1 (#2261). Copies every #342 work-order mirror (a core order with an order↔production_run or order↔inventory_order link) into work_order / work_order_item, keeping the mirror's id, display_id, created_at and line ids, and links each work order to its runs. Idempotent upsert — re-running RESYNCS (creates missing rows, updates changed ones, removes lines the mirror dropped), so it also repairs changes that bypassed the shadow write. After applying, moves the display_id sequence past the highest number. Dry-run lists what would be created vs resynced. Target specific orders with order_ids, else all mirrors (bounded by limit, default 500, max ${MAX_SCAN}).`,
  params: [
    { name: "order_ids", type: "string", required: false, description: "Comma-separated mirror order ids (default: every mirror)" },
    { name: "limit", type: "number", required: false, description: `Max orders per call (default 500, max ${MAX_SCAN})` },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { order_ids, limit } = z
      .object({ order_ids: idsParam, limit: z.coerce.number().int().positive().max(MAX_SCAN).optional().default(500) })
      .parse(params)

    const targets = (order_ids.length ? order_ids : await listMirrorOrderIds(container)).slice(0, limit)
    const service: any = container.resolve(WORK_ORDER_MODULE)
    const existing = new Set<string>()
    for (const batch of chunks(targets, CHUNK)) {
      const rows = await service.listWorkOrders({ id: batch }, { select: ["id"] })
      for (const r of rows) existing.add(r.id)
    }

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []
    let created = 0
    let resynced = 0
    let skipped = 0

    for (const id of targets) {
      const planned = existing.has(id) ? "resync" : "create"
      if (dry_run) {
        changes.push({ entity: "work_order", id, field: "sync", before: existing.has(id) ? "exists" : null, after: planned })
        continue
      }
      try {
        const outcome = await syncWorkOrderFromMirror(container, id)
        if (outcome.status === "skipped") {
          skipped++
          errors.push({ id, message: `skipped: ${outcome.reason}` })
          continue
        }
        outcome.status === "created" ? created++ : resynced++
        changes.push({ entity: "work_order", id, field: "sync", before: existing.has(id) ? "exists" : null, after: outcome.status })
      } catch (e: any) {
        errors.push({ id, message: e?.message ?? String(e) })
      }
    }

    // Carried-over display_ids were inserted explicitly; move the sequence past
    // them so a work order minted natively (S3) can never reuse a number.
    if (!dry_run && created) {
      const pg: any = container.resolve(ContainerRegistrationKeys.PG_CONNECTION)
      await pg.raw(
        `select setval(pg_get_serial_sequence('work_order', 'display_id'), greatest((select coalesce(max(display_id), 0) from work_order), 1))`
      )
    }

    const summary = dry_run
      ? `Would create ${changes.filter((c) => c.after === "create").length} and resync ${changes.filter((c) => c.after === "resync").length} work order(s) of ${targets.length} mirror(s)`
      : `Created ${created}, resynced ${resynced}, skipped ${skipped}, failed ${errors.length - skipped} of ${targets.length} mirror(s)`
    return {
      job_id: backfillWorkOrdersJob.id,
      dry_run,
      applied: !dry_run && created + resynced > 0,
      summary,
      changes,
      errors,
    }
  },
}

/**
 * Pure: the contract keys on which a served work order and its mirror differ.
 * Exported for unit testing.
 */
export const diffContract = (served: any, mirror: any): string[] => {
  const a = pickWorkOrderContract(served) as Record<string, unknown>
  const b = pickWorkOrderContract(mirror) as Record<string, unknown>
  return Object.keys(b).filter((k) => !isDeepStrictEqual(a[k], b[k]))
}

export type ListSets = { design: string[]; inventory: string[]; retail_excluded: string[] }

/**
 * Pure: where the admin order lists would hold DIFFERENT orders with
 * `WORK_ORDER_READS` on (#2264 S2b) than they do today. `off` is what the
 * flag-off route computes (links + the `legacy_id` metadata net); `on` is
 * `work_order` by kind, and the retail exclusion `workOrderIdsInCore`.
 * Exported for unit testing.
 */
export const diffListMembership = (off: ListSets, on: ListSets): MaintenanceChange[] => {
  const changes: MaintenanceChange[] = []
  for (const list of ["design", "inventory", "retail_excluded"] as const) {
    const a = new Set(off[list])
    const b = new Set(on[list])
    for (const id of a) {
      if (!b.has(id)) {
        changes.push({ entity: "order", id, field: `list:${list}`, before: "listed", after: "not listed", note: "flag off → flag on" })
      }
    }
    for (const id of b) {
      if (!a.has(id)) {
        changes.push({ entity: "order", id, field: `list:${list}`, before: "not listed", after: "listed", note: "flag off → flag on" })
      }
    }
  }
  return changes
}

export const workOrderParityJob: MaintenanceJob = {
  id: "work-order-parity",
  label: "Work order parity with the core-order mirror",
  description:
    "#2263 S1 (#2261). READ-ONLY. For every mirror: is there a work_order, and does it read to partner-ui / admin exactly as the mirror does (pickWorkOrderContract on toOrderShape(work_order) vs the mirror)? Reports each mismatch with the fields that differ, and each mirror with no work_order. Unless order_ids is given, also compares the ADMIN LISTS (#2264 S2b): which orders GET /admin/orders?kind=design|inventory holds, and which it keeps out of retail, flag off vs WORK_ORDER_READS on — each difference is a change with field list:<name>. Writes nothing in either mode. The target before flipping WORK_ORDER_READS: 0 mismatches, 0 missing, 0 list differences.",
  params: [
    { name: "order_ids", type: "string", required: false, description: "Comma-separated mirror order ids (default: every mirror)" },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { order_ids } = z.object({ order_ids: idsParam }).parse(params)
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const targets = order_ids.length ? order_ids : await listMirrorOrderIds(container)

    const changes: MaintenanceChange[] = []
    let missing = 0
    let mismatched = 0

    for (const batch of chunks(targets, CHUNK)) {
      const { data: mirrors } = await query.graph({
        entity: "order",
        fields: WORK_ORDER_MIRROR_FIELDS,
        filters: { id: batch },
      })
      const { data: stored } = await query.graph({
        entity: "work_order",
        // The fields the S2 routes read — so this checks what they serve.
        fields: WORK_ORDER_READ_FIELDS,
        filters: { id: batch },
      })
      const byId = new Map<string, any>((stored ?? []).map((w: any) => [w.id, w]))
      for (const mirror of mirrors ?? []) {
        const wo = byId.get(mirror.id)
        if (!wo) {
          missing++
          changes.push({ entity: "work_order", id: mirror.id, field: "missing", before: "mirror", after: null, note: "no work_order for this mirror" })
          continue
        }
        const fields = diffContract(toOrderShape(wo), mirror)
        if (fields.length) {
          mismatched++
          const a = pickWorkOrderContract(toOrderShape(wo)) as any
          const b = pickWorkOrderContract(mirror) as any
          changes.push({
            entity: "work_order",
            id: mirror.id,
            field: fields.join(","),
            before: Object.fromEntries(fields.map((f) => [f, b[f]])),
            after: Object.fromEntries(fields.map((f) => [f, a[f]])),
            note: "before = mirror, after = work_order",
          })
        }
      }
    }

    // The admin lists, flag off vs on — only on a full run: a targeted run
    // cannot say what a whole list holds.
    let listSummary = ""
    if (!order_ids.length) {
      const [design, inventory, retailExcludedOn, { data: rows }] = await Promise.all([
        collectWorkOrderIds(query, "design"),
        collectWorkOrderIds(query, "inventory"),
        workOrderIdsInCore(container),
        query.graph({ entity: "work_order", fields: ["id", "kind"] }),
      ])
      const byKind = (k: string) => (rows ?? []).filter((r: any) => r.kind === k).map((r: any) => r.id)
      const listChanges = diffListMembership(
        { design, inventory, retail_excluded: [...new Set([...design, ...inventory])] },
        { design: byKind("design"), inventory: byKind("inventory"), retail_excluded: retailExcludedOn }
      )
      changes.push(...listChanges)
      listSummary =
        `; admin lists: design ${design.length}→${byKind("design").length}, ` +
        `inventory ${inventory.length}→${byKind("inventory").length}, ` +
        `kept out of retail ${new Set([...design, ...inventory]).size}→${retailExcludedOn.length}, ` +
        `${listChanges.length} list difference(s)`
    }

    return {
      job_id: workOrderParityJob.id,
      dry_run,
      applied: false,
      summary: `${targets.length} mirror(s): ${targets.length - missing - mismatched} match, ${mismatched} mismatch, ${missing} missing a work_order${listSummary}`,
      changes,
      errors: [],
    }
  },
}
