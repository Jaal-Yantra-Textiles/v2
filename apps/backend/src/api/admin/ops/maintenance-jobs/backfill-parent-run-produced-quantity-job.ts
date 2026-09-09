import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"

import { PRODUCTION_RUNS_MODULE } from "../../../../modules/production_runs"
import type ProductionRunService from "../../../../modules/production_runs/service"
import {
  computeParentRollup,
  type RollupChild,
} from "../../../../workflows/production-runs/lib/parent-run-rollup"
import type { MaintenanceChange, MaintenanceJob, MaintenanceJobResult } from "./registry"

const MAX_SCAN = 5000
const PAGE = 200

const paramsSchema = z.object({
  run_ids: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      (Array.isArray(v) ? v : String(v ?? "").split(","))
        .map((s) => s.trim())
        .filter(Boolean)
    ),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_SCAN)
    .optional()
    .default(500),
})

const RUN_FIELDS = [
  "id",
  "status",
  "quantity",
  "produced_quantity",
  "parent_run_id",
  "completed_at",
]

/**
 * #1877 — a parent run completed by the SIGNAL cascade recorded no output.
 *
 * Three paths complete a parent production run. `complete-production-run.ts`
 * and the repair script reconciled the parent's totals from its children;
 * `run-production-run-lifecycle.ts` set `status` + `completed_at` and nothing
 * else. So whether a completed parent carries the output the partner actually
 * reported came down to which path happened to fire, and the lifecycle path
 * leaves it `null` beside children that each state a real number. Every
 * downstream reader — cost summary, payout, provenance, order fulfilment —
 * then falls back to the ORDERED quantity and assumes it was all made.
 *
 * The code path is fixed. This is the historical repair, exposed here so it
 * runs from the Ops console / MCP instead of a one-off ECS `medusa exec`.
 *
 * ## What it will and will not write
 *
 * It writes `produced_quantity` ONLY, and only the figure the children
 * actually STATED. It deliberately does not use the ordered-quantity fallback
 * that the live cascades use: a child that never reported output contributes
 * nothing, rather than having what it was ASKED to make promoted into a record
 * of what it DID make. That is the precise lie this whole thread is about.
 *
 * It never touches `status` or `completed_at` — these parents are already
 * terminal and re-dating them rewrites history. It skips any parent that
 * already states a figure (including `0`, which is a real claim, not a gap),
 * so it is idempotent and safe to re-run.
 *
 * Parents where NEITHER the parent nor any child states output are reported in
 * the summary and left alone. There is nothing to roll up and inventing a
 * number would be worse than the null.
 */
export const backfillParentRunProducedQuantityJob: MaintenanceJob = {
  id: "backfill-parent-run-produced-quantity",
  label: "Backfill produced_quantity on parent production runs",
  description:
    `Roll a completed parent production run's produced_quantity up from its children, for the parents the signal-driven lifecycle cascade completed without reconciling totals (#1877). Writes produced_quantity only, only from what children actually STATED — never the ordered-quantity fallback — and never touches status or completed_at. Skips parents that already state a figure (0 included), so it is idempotent. Parents where nothing anywhere states output are reported and left null. Provide run_ids to target specific parents, or omit for a bounded scan (default 500, max ${MAX_SCAN}). Dry-run previews; apply writes.`,
  params: [
    {
      name: "run_ids",
      type: "string",
      required: false,
      description:
        "Comma-separated PARENT production run ids to target (default: scan all parents)",
    },
    {
      name: "limit",
      type: "number",
      required: false,
      description: `Max parents to update in one call (default 500, max ${MAX_SCAN})`,
    },
  ],
  run: async (container, { dry_run, params }): Promise<MaintenanceJobResult> => {
    const { run_ids, limit } = paramsSchema.parse(params)

    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)

    const changes: MaintenanceChange[] = []
    const errors: Array<{ id: string; message: string }> = []

    // Page the whole run table on a handful of columns and group in memory.
    // Grouping needs every child of a parent present at once, so a filtered
    // page could split a sibling set and make a parent look complete when it
    // is not.
    const all: RollupChild[] & Array<any> = []
    for (let skip = 0; skip < MAX_SCAN; skip += PAGE) {
      const { data: rows } = await query.graph({
        entity: "production_runs",
        fields: RUN_FIELDS,
        pagination: { skip, take: PAGE },
      })
      if (!rows?.length) break
      all.push(...rows)
      if (rows.length < PAGE) break
    }

    const byParent = new Map<string, any[]>()
    for (const r of all) {
      const p = r?.parent_run_id
      if (!p) continue
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p)!.push(r)
    }
    const parentById = new Map<string, any>(
      all.filter((r: any) => !r?.parent_run_id).map((r: any) => [r.id, r])
    )

    let scanned = 0
    let skippedAlreadyStated = 0
    let skippedNotAllCompleted = 0
    let skippedNotCompleted = 0
    let skippedNoOutputAnywhere = 0

    const targets = run_ids.length
      ? run_ids.filter((id) => byParent.has(id))
      : [...byParent.keys()]

    for (const parentId of targets) {
      if (changes.length >= limit) break

      const kids = byParent.get(parentId) ?? []
      const parent = parentById.get(parentId)
      if (!parent) continue
      scanned++

      // Only already-COMPLETED parents. A parent still open is the stuck-parent
      // case, which completes through the cascade / repair script and involves
      // status and completed_at — a different decision, deliberately not made
      // here.
      if (String(parent.status) !== "completed") {
        skippedNotCompleted++
        continue
      }

      const rollup = computeParentRollup(kids)
      if (!rollup.all_completed) {
        skippedNotAllCompleted++
        continue
      }

      // `0` is a statement, not a gap. Only `null` is missing.
      if (
        parent.produced_quantity != null &&
        Number.isFinite(Number(parent.produced_quantity))
      ) {
        skippedAlreadyStated++
        continue
      }

      if (rollup.produced_stated <= 0) {
        skippedNoOutputAnywhere++
        continue
      }

      const note =
        `${kids.length} child(ren) state ${rollup.produced_stated} of ${rollup.quantity} ordered` +
        (rollup.children_missing_produced
          ? `; ${rollup.children_missing_produced} child(ren) state none and contribute nothing`
          : "")

      if (!dry_run) {
        try {
          await service.updateProductionRuns({
            id: parentId,
            produced_quantity: rollup.produced_stated,
          } as any)
        } catch (e: any) {
          errors.push({ id: parentId, message: e?.message ?? String(e) })
          continue
        }
      }

      changes.push({
        entity: "production_run",
        id: parentId,
        field: "produced_quantity",
        before: null,
        after: rollup.produced_stated,
        note,
      })
    }

    const verb = dry_run ? "Would backfill" : "Backfilled"
    return {
      job_id: backfillParentRunProducedQuantityJob.id,
      dry_run,
      applied: !dry_run && changes.length > 0,
      summary:
        `${verb} produced_quantity on ${changes.length} parent run(s) ` +
        `(${changes.reduce((a, c) => a + Number(c.after ?? 0), 0)} units) ` +
        `across ${scanned} parent(s) scanned — ` +
        `${skippedAlreadyStated} already stated, ${skippedNotCompleted} not completed, ` +
        `${skippedNotAllCompleted} with open children, ` +
        `${skippedNoOutputAnywhere} where no child states any output (left null), ` +
        `${errors.length} error(s)`,
      changes,
      errors,
    }
  },
}
