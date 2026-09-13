import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { ORDER_INVENTORY_MODULE } from "../../../../modules/inventory_orders"
import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const MAX_SCAN = 10000
const PAGE = 200

const paramsSchema = z.object({
  entity: z.enum(["inventory_orders", "production_runs", "both"]).optional().default("both"),
  limit: z.coerce.number().int().positive().max(MAX_SCAN).optional().default(MAX_SCAN),
})

type Target = {
  entity: "inventory_orders" | "production_runs"
  module: string
  idField: "inventory_orders_id" | "production_runs_id"
}

const TARGETS: Target[] = [
  { entity: "inventory_orders", module: ORDER_INVENTORY_MODULE, idField: "inventory_orders_id" },
  { entity: "production_runs", module: PRODUCTION_RUNS_MODULE, idField: "production_runs_id" },
]

/**
 * #342 PR-E / #2026 — create the D5 order↔execution link on rows that only
 * carry the older `metadata.unified_order_id` backref.
 *
 * Rows projected before PR-A made the link authoritative hold the unified-order
 * pointer only as that backref (Chunk 6 then stopped writing it). Until they
 * also carry the managed order↔inventory_order / order↔production_run link, the
 * `<link> ?? metadata.unified_order_id` fallback reads cannot be deleted.
 *
 * ## Why this is a JOB and not only a script
 *
 * The logic already existed as `src/scripts/backfill-unified-order-links.ts`, an
 * ops-run `medusa exec`. That made it unrunnable and unauditable from the Ops
 * console or MCP — and, worse, unprovable: #2026 needed to know whether it had
 * ever run, and nothing recorded that. A one-off ECS task's CloudWatch stream is
 * not an audit trail. Here every run lands in ops_audit with its changes.
 *
 * 🔴 It also had a live footgun. `run-backfill.sh` exported DRY_RUN as an env
 * var while this script parsed a POSITIONAL `dry-run`, so
 * `DRY_RUN=1 ./run-backfill.sh backfill-unified-order-links` APPLIED to prod
 * while printing "DRY_RUN: 1". The runner is fixed, but a job whose preview and
 * apply are one typed flag cannot drift that way again.
 *
 * ## What it writes
 *
 * The LINK, and nothing else. No status, no metadata, no projection. Rows that
 * were never dual-written have no backref to follow and stay legacy-only by
 * design — that is the T4 scope decision, not an oversight, and inventing a
 * unified order for them here would be projecting history.
 *
 * 🔑 A backref is VALIDATED before it is trusted: the order it names must still
 * exist. A dangling backref is reported for manual review, never linked — a link
 * to a deleted order is worse than no link, because every reader downstream
 * treats link presence as the authoritative pointer.
 *
 * Idempotent: rows that already resolve `order.id` are skipped, and a create
 * that loses a race to an existing link is counted as already-linked rather than
 * failed.
 *
 * ## Prod state at the time of writing
 *
 * 2026-09-13, dry run against prod RDS:
 *   inventory_orders  linked=0 alreadyLinked=18 dangling=0 noBackref=1
 *   production_runs   linked=0 alreadyLinked=86 dangling=0 noBackref=58
 * Nothing to do — every linkable row is linked. Recorded here so the next
 * reader does not have to re-derive it, and so a future non-zero result is
 * visibly a change rather than a first look.
 */
export const backfillUnifiedOrderLinksJob: MaintenanceJob = {
  id: "backfill-unified-order-links",
  label: "Backfill the order↔execution (D5) link from metadata backrefs",
  description:
    "Create the managed order↔inventory_order / order↔production_run link for legacy rows that carry only the metadata.unified_order_id backref (#342 PR-E). Writes the LINK only — never status, metadata or a projection. Validates that the backref'd order still exists and reports dangling ones instead of linking to a deleted order. Rows never dual-written have no backref and stay legacy-only by design. Idempotent. As of 2026-09-13 prod has nothing to link (104 already linked); this exists so the operation is runnable and AUDITABLE from Ops/MCP rather than a one-off ECS medusa exec. Dry-run previews; apply writes.",
  params: [
    {
      name: "entity",
      type: "string",
      required: false,
      description: "'inventory_orders' | 'production_runs' | 'both' (default both)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max rows to scan per entity (default ${MAX_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { entity, limit } = paramsSchema.parse(params)

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const remoteLink: any = container.resolve(ContainerRegistrationKeys.LINK)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    const targets = TARGETS.filter((t) => entity === "both" || t.entity === entity)
    const tally: Record<string, { alreadyLinked: number; dangling: number; noBackref: number }> = {}

    for (const target of targets) {
      tally[target.entity] = { alreadyLinked: 0, dangling: 0, noBackref: 0 }

      for (let skip = 0; skip < limit; skip += PAGE) {
        const { data: rows } = await query.graph({
          entity: target.entity,
          fields: ["id", "order.id", "metadata"],
          pagination: { take: PAGE, skip },
        })
        if (!rows?.length) break

        const candidates: Array<{ legacyId: string; unifiedOrderId: string }> = []
        for (const row of rows as any[]) {
          if (row?.order?.id) {
            tally[target.entity].alreadyLinked++
            continue
          }
          const backref = row?.metadata?.unified_order_id
          if (!backref) {
            // Never projected, or the backref was already cleaned. Either way
            // there is nothing here to follow.
            tally[target.entity].noBackref++
            continue
          }
          candidates.push({ legacyId: String(row.id), unifiedOrderId: String(backref) })
        }

        if (!candidates.length) continue

        // Validate before linking — never point the authoritative link at an
        // order that no longer exists.
        const { data: orders } = await query.graph({
          entity: "order",
          fields: ["id"],
          filters: { id: [...new Set(candidates.map((c) => c.unifiedOrderId))] },
        })
        const live = new Set((orders as any[]).map((o) => String(o.id)))

        for (const c of candidates) {
          if (!live.has(c.unifiedOrderId)) {
            tally[target.entity].dangling++
            errors.push({
              id: c.legacyId,
              message: `backref order ${c.unifiedOrderId} not found — left unlinked for manual review`,
            })
            continue
          }

          if (!dry_run) {
            try {
              await remoteLink.create([
                {
                  [Modules.ORDER]: { order_id: c.unifiedOrderId },
                  [target.module]: { [target.idField]: c.legacyId },
                },
              ])
            } catch (e: any) {
              // Most likely the link already exists (a race, or a partial prior
              // run). That is the desired end state, not a failure.
              const msg = String(e?.message ?? e)
              if (!/exist/i.test(msg)) {
                errors.push({ id: c.legacyId, message: msg })
                continue
              }
              tally[target.entity].alreadyLinked++
              continue
            }
          }

          changes.push({
            entity: target.entity,
            id: c.legacyId,
            field: "order_link",
            before: null,
            after: c.unifiedOrderId,
            note: `link ${target.entity} ${c.legacyId} → order ${c.unifiedOrderId} (from metadata.unified_order_id)`,
          })
        }
      }
    }

    const per = Object.entries(tally)
      .map(
        ([e, t]) =>
          `${e}: ${t.alreadyLinked} already linked, ${t.noBackref} with no backref, ${t.dangling} dangling`
      )
      .join("; ")

    const verb = dry_run ? "Would link" : "Linked"
    return {
      job_id: backfillUnifiedOrderLinksJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary: `${verb} ${changes.length} row(s) to their unified order — ${per} — ${errors.length} error(s)`,
      changes,
      errors,
    }
  },
}
