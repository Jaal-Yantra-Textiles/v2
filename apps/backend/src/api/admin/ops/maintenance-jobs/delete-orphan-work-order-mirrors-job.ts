import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import type {
  MaintenanceChange,
  MaintenanceJob,
  MaintenanceJobResult,
} from "./registry"

/**
 * Data Plumbing — retire a work-order mirror whose EXECUTION ROW IS GONE.
 *
 * ## What breaks
 *
 * `dual-write-unified-order.ts` / `dual-write-unified-run-order.ts` project
 * every inventory order and production run onto a core `order` row (#342 T2),
 * stamping `metadata.legacy_id` with the id of the thing it mirrors. Delete the
 * inventory order and the mirror survives with nothing pointing at it.
 *
 * That is not cosmetic. `/admin/orders` decides the order family by walking the
 * EXECUTION table and collecting `order.id` off each row, so an order no
 * execution row points at is collected by nobody, excluded from nothing, and
 * falls through to the classifier's default: RETAIL. A raw-material purchase
 * order starts reading as a customer sale.
 *
 * Live on production when this was written: `order_01M231KWSJGQS2V5AMDBDXGNEH`
 * (#107, ₹14,000) sat among EIGHT retail orders, while
 * `inv_order_01M231KWG9CG5VQJHXCS36T0YH` — the id its own metadata names —
 * 404s. Its twin #108, created seven minutes later, is a real shipment.
 *
 * The classifier now reads `legacy_id` as a fallback, so an orphan no longer
 * misreports as retail. This job is the other half: the row itself is still
 * a mirror of nothing, and nothing will ever update it again.
 *
 * ## SOFT delete, and only soft
 *
 * `softDeleteOrders` — the row leaves every list (Medusa filters `deleted_at`)
 * and can be brought back. A hard delete of an order is not offered here on
 * purpose: an order carries line items, totals and links that other rows point
 * at, the mirrors are cheap to leave dormant, and "reversible" is worth more
 * than "tidy" on a table that decides money.
 *
 * ## What it refuses
 *
 *   · a mirror whose execution row still EXISTS — that is a live work order,
 *     and the whole point is to touch only the ones pointing at nothing.
 *   · an order with no `legacy_id` — a genuine retail order, never eligible.
 *   · an order that is `completed`, or that has captured payment, unless
 *     `include_settled=true`. A mirror that reached either is a record of
 *     something that happened, and #107's shape (cancelled, unpaid) is the one
 *     this exists for.
 *
 * Idempotent: a soft-deleted row is not returned by the scan, so a second run
 * matches nothing.
 */

/** Bounds one call's blast radius; bigger sweeps raise `limit` across calls. */
export const MAX_ORPHAN_MIRROR_SCAN = 1000

const paramsSchema = z.object({
  /**
   * Restrict to one family. Omitted = both. `inventory` mirrors inventory
   * orders, `design` mirrors production runs.
   */
  kind: z.enum(["inventory", "design"]).optional(),
  /** Act on exactly this order and nothing else — the surgical case (#107). */
  order_id: z.string().min(1).optional(),
  /**
   * Also retire mirrors that completed or took money. Off by default: those
   * rows record something that actually happened.
   */
  include_settled: z.boolean().optional().default(false),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_ORPHAN_MIRROR_SCAN)
    .optional()
    .default(200),
})

export const MIRROR_PREFIX = {
  inventory: { prefix: "inv_order_", entity: "inventory_orders" },
  design: { prefix: "prod_run_", entity: "production_runs" },
} as const

export type MirrorKind = keyof typeof MIRROR_PREFIX

/**
 * Pure: is this order a mirror of the given kind, and of what?
 *
 * Split out so the selection rule is testable without a database — the part
 * that decides which production rows a delete touches is exactly the part that
 * must be provable.
 */
export function readMirrorLegacyId(
  order: { metadata?: Record<string, unknown> | null },
  kind: MirrorKind
): string | null {
  const legacyId = order?.metadata?.legacy_id
  if (typeof legacyId !== "string") return null
  return legacyId.startsWith(MIRROR_PREFIX[kind].prefix) ? legacyId : null
}

/**
 * Pure: should this mirror be retired?
 *
 * `null` means eligible; a string is the reason it is being skipped, and that
 * reason travels into the dry-run so an operator can see WHY a row was passed
 * over rather than having to re-derive it.
 */
export function skipReason(
  order: { status?: string | null; summary?: { paid_total?: number } | null },
  executionExists: boolean,
  includeSettled: boolean
): string | null {
  if (executionExists) {
    return "its execution row still exists — this is a live work order"
  }
  if (includeSettled) return null
  if (order?.status === "completed") {
    return "completed — records work that happened (pass include_settled to override)"
  }
  const paid = Number(order?.summary?.paid_total ?? 0)
  if (paid > 0) {
    return `captured ${paid} — records money that moved (pass include_settled to override)`
  }
  return null
}

const summarize = (dryRun: boolean, retired: number, skipped: number): string => {
  const verb = dryRun ? "Would retire" : "Retired"
  if (retired === 0 && skipped === 0) {
    return "No work-order mirrors found whose execution row is missing."
  }
  return (
    `${verb} ${retired} orphaned work-order mirror${retired === 1 ? "" : "s"}` +
    (skipped ? `; skipped ${skipped} (see notes).` : ".")
  )
}

export const deleteOrphanWorkOrderMirrorsJob: MaintenanceJob = {
  id: "delete-orphan-work-order-mirrors",
  label: "Retire work-order mirrors whose execution row is gone",
  description:
    "Soft-delete core `order` rows that mirror an inventory order or production run which no longer exists. An orphan mirror is collected by no execution walk, so /admin/orders falls back to its default and lists it as a RETAIL sale — a raw-material PO reading as a customer order (#107, ₹14,000, live). Preview (default) lists exactly which rows would be retired and why any were skipped; apply soft-deletes them, which is reversible. Refuses mirrors whose execution row still exists, orders with no legacy_id, and (unless include_settled) anything completed or paid.",
  params: [
    {
      name: "kind",
      type: "string",
      required: false,
      description: "'inventory' or 'design'. Omit for both.",
    },
    {
      name: "order_id",
      type: "string",
      required: false,
      description: "Act on exactly this order id and nothing else.",
    },
    {
      name: "include_settled",
      type: "boolean",
      required: false,
      description:
        "Also retire mirrors that are completed or have captured payment (default false)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max mirrors to retire in one call (default 200, max ${MAX_ORPHAN_MIRROR_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const parsed = paramsSchema.safeParse(params)
    if (!parsed.success) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        parsed.error.issues.map((i) => i.message).join("; ")
      )
    }
    const { kind, order_id, include_settled, limit } = parsed.data

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const orderService: any = container.resolve(Modules.ORDER)

    const kinds: MirrorKind[] = kind ? [kind] : ["inventory", "design"]

    const changes: MaintenanceChange[] = []
    const toRetire: string[] = []
    let skipped = 0

    for (const k of kinds) {
      const { entity } = MIRROR_PREFIX[k]

      // Which execution rows still exist, by their own id. Read once per kind
      // rather than per order — the point is to answer "is this id still
      // there", and a per-row lookup would turn a sweep into N queries.
      const live = new Set<string>()
      const { data: execRows } = await query.graph({
        entity,
        fields: ["id"],
        pagination: { skip: 0, take: MAX_ORPHAN_MIRROR_SCAN },
      })
      for (const row of execRows ?? []) {
        if (row?.id) live.add(row.id)
      }

      /*
       * 🔴 Read through `query.graph` with the fields NAMED, not through
       * `listOrders`.
       *
       * The first version used `orderService.listOrders(...)`, whose default
       * selection does NOT include `metadata`. Every order therefore arrived
       * with `metadata` undefined, `readMirrorLegacyId` returned null for all
       * of them, and the job reported
       *
       *     "No work-order mirrors found whose execution row is missing."
       *
       * on a database where #107 was sitting in plain sight — a clean bill of
       * health from a query that had not looked. The unit tests could not catch
       * it: they hand the pure selection functions rows that already carry
       * metadata, so they test the RULE while the fault was in the READ. Only
       * running it against production showed it, and what it showed was silence.
       *
       * `summary.*` is expanded because the settled-money guard reads
       * `summary.paid_total`, and an unexpanded summary would make every paid
       * mirror look unpaid — the same silence, one field over.
       */
      const orderFilters: Record<string, unknown> = {}
      if (order_id) orderFilters.id = order_id

      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["id", "status", "total", "metadata", "summary.*"],
        filters: orderFilters,
        pagination: { skip: 0, take: MAX_ORPHAN_MIRROR_SCAN },
      })

      for (const order of orders ?? []) {
        if (toRetire.length >= limit) break

        const legacyId = readMirrorLegacyId(order, k)
        if (!legacyId) continue

        const reason = skipReason(order, live.has(legacyId), include_settled)
        if (reason) {
          // Only report a skip an operator could be surprised by. A live work
          // order is the overwhelmingly normal case and would drown the list.
          if (!live.has(legacyId)) {
            skipped += 1
            changes.push({
              entity: "order",
              id: order.id,
              field: "skipped",
              before: legacyId,
              after: null,
              note: reason,
            })
          }
          continue
        }

        toRetire.push(order.id)
        changes.push({
          entity: "order",
          id: order.id,
          field: "deleted_at",
          before: null,
          after: "soft-deleted",
          note:
            `mirrors ${legacyId}, which no longer exists — without this the ` +
            `order lists as RETAIL (status=${order.status ?? "?"}, ` +
            `total=${order.total ?? "?"})`,
        })
      }
    }

    if (!dry_run && toRetire.length > 0) {
      await orderService.softDeleteOrders(toRetire)
    }

    return {
      job_id: deleteOrphanWorkOrderMirrorsJob.id,
      dry_run,
      applied: !dry_run && toRetire.length > 0,
      summary: summarize(dry_run, toRetire.length, skipped),
      changes,
    }
  },
}
