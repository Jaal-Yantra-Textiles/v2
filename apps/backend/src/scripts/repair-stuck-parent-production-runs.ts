import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"
import {
  computeParentRollup,
  parentTotalsPatch,
} from "../workflows/production-runs/lib/parent-run-rollup"

/**
 * Repair — complete parent production runs left STUCK after all their
 * child runs completed.
 *
 * Why: child runs completed by the partner without ever being dispatched
 * carry no `lifecycle_transaction_id`. The complete-production-run
 * workflow signalled the lifecycle's `await-run-complete` gate to fire
 * `cascadeCompletionStep` (which marks the parent completed) — but
 * `signalLifecycleStepStep` silently no-ops on a null transaction id, so
 * the cascade never ran and the parent stayed `in_progress` forever.
 * The inline `cascadeParentCompletionStep` added to
 * complete-production-run.ts fixes this going forward; this script
 * repairs the runs already stuck.
 *
 * What it does: for every parent run whose children are ALL completed,
 * if the parent is in a stuck (non-terminal) status, marks it completed
 * and reconciles its totals from the children (fixes parent/child
 * quantity mismatch). completed_at = latest child completed_at.
 *
 * It ALSO repairs parents that are already `completed` but carry
 * `produced_quantity: null` — the signal-driven cascade in
 * `run-production-run-lifecycle.ts` completed parents without reconciling
 * totals, so seven prod parents read `completed` with a null output while
 * their children each state a real number. Those were previously skipped as
 * "already correct". Only the output is written, only from what the children
 * actually STATED (no fall back to the ordered quantity), and `status` /
 * `completed_at` are left untouched.
 *
 * By default it does NOT touch parents that are already `cancelled`
 * (those may have been cancelled intentionally). Pass specific ids via
 * `--force-run-ids=` / `FORCE_RUN_IDS=` to also complete cancelled
 * parents (e.g. ones an operator cancelled as a workaround).
 *
 * Run:
 *   npx medusa exec ./src/scripts/repair-stuck-parent-production-runs.ts
 *
 * Dry run:
 *   DRY_RUN=1 npx medusa exec ./src/scripts/repair-stuck-parent-production-runs.ts
 *
 * Force-complete specific (incl. cancelled) parents:
 *   FORCE_RUN_IDS=prod_run_a,prod_run_b npx medusa exec ./src/scripts/...
 */

const STUCK_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "sent_to_partner",
  "in_progress",
]

export default async function repairStuckParentProductionRuns({
  container,
  args,
}: ExecArgs) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const service: ProductionRunService = container.resolve(PRODUCTION_RUNS_MODULE)

  const argList = args ?? []
  const dryRun = argList.includes("--dry-run") || process.env.DRY_RUN === "1"
  const parseList = (flag: string, envVar: string): Set<string> => {
    const fromArg = argList
      .map((a) => (a.startsWith(`${flag}=`) ? a.slice(flag.length + 1) : null))
      .find((v): v is string => v !== null)
    const raw = fromArg ?? process.env[envVar] ?? ""
    return new Set(
      raw.split(",").map((s) => s.trim()).filter(Boolean)
    )
  }
  const forceIds = parseList("--force-run-ids", "FORCE_RUN_IDS")

  if (dryRun) logger.info("DRY RUN — no runs will be updated.")
  if (forceIds.size) logger.info(`Force-complete ids: ${[...forceIds].join(", ")}`)

  // 1. Every child run (parent_run_id set) + its parent + status.
  const { data: children } = await query.graph({
    entity: "production_runs",
    filters: { parent_run_id: { $ne: null } } as any,
    fields: [
      "id",
      "status",
      "quantity",
      "produced_quantity",
      "completed_at",
      "parent_run_id",
    ],
    pagination: { skip: 0, take: 5000 },
  })

  // 2. Group children by parent.
  const byParent = new Map<string, any[]>()
  for (const c of (children ?? []) as any[]) {
    const p = c.parent_run_id
    if (!p) continue
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p)!.push(c)
  }

  let completed = 0
  let skippedNotAllDone = 0
  let skippedTerminal = 0
  let outputBackfilled = 0
  let skippedNoOutputAnywhere = 0
  const errors: Array<{ parent_id: string; error: string }> = []

  for (const [parentId, kids] of byParent) {
    const rollup = computeParentRollup(kids)
    if (!rollup.all_completed) {
      skippedNotAllDone++
      continue
    }

    const parent = (await service
      .retrieveProductionRun(parentId)
      .catch(() => null)) as any
    if (!parent) continue

    const status = String(parent.status)
    if (status === "completed") {
      /**
       * `completed` was treated as "already correct" and skipped. It is not:
       * the signal-driven cascade in `run-production-run-lifecycle.ts`
       * completed parents WITHOUT reconciling totals, so a parent can read
       * `completed` with `produced_quantity: null` while every child states a
       * real number. Seven such parents exist in production. Skipping them is
       * what made this repair unable to reach the very rows it was written
       * for.
       *
       * Only the OUTPUT is repaired here, and only from what the children
       * actually stated — `allowFallback` is off, so a child that never
       * reported output contributes nothing rather than having its ORDERED
       * quantity silently promoted into a production figure. `status` and
       * `completed_at` are left exactly as they are: this parent is already
       * terminal and re-dating it would rewrite history.
       */
      const producedNow = Number(parent.produced_quantity)
      const alreadyStated =
        parent.produced_quantity != null && Number.isFinite(producedNow)
      if (alreadyStated) continue

      if (rollup.produced_stated <= 0) {
        // Nothing anywhere states output — neither parent nor any child. There
        // is nothing to roll up and inventing a number would be worse than the
        // null. Reported, not written.
        skippedNoOutputAnywhere++
        continue
      }

      const patch = parentTotalsPatch(rollup)
      const otag = `parent ${parentId} (completed, produced null→${rollup.produced_stated}${
        rollup.children_missing_produced
          ? `, ${rollup.children_missing_produced} child(ren) state none`
          : ""
      })`

      if (dryRun) {
        logger.info(`WOULD backfill output ${otag}`)
        outputBackfilled++
        continue
      }

      try {
        await service.updateProductionRuns({
          id: parentId,
          produced_quantity: patch.produced_quantity,
        } as any)
        logger.info(`Backfilled output ${otag}`)
        outputBackfilled++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.error(`Failed ${otag}: ${message}`)
        errors.push({ parent_id: parentId, error: message })
      }
      continue
    }

    const isStuck = STUCK_STATUSES.includes(status)
    const isForced = forceIds.has(parentId)
    if (!isStuck && !isForced) {
      // e.g. cancelled and not explicitly forced.
      skippedTerminal++
      continue
    }

    // Reconcile totals from children — same helper the two live cascades use.
    const totals = parentTotalsPatch(rollup, { allowFallback: true })
    const tag = `parent ${parentId} (${status} → completed, qty ${parent.quantity}→${rollup.quantity}, produced→${totals.produced_quantity ?? 0})${isForced ? " [forced]" : ""}`

    if (dryRun) {
      logger.info(`WOULD complete ${tag}`)
      completed++
      continue
    }

    try {
      await service.updateProductionRuns({
        id: parentId,
        status: "completed" as any,
        completed_at: rollup.completed_at ?? new Date(),
        cancelled_at: null,
        ...totals,
      } as any)
      logger.info(`Completed ${tag}`)
      completed++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error(`Failed ${tag}: ${message}`)
      errors.push({ parent_id: parentId, error: message })
    }
  }

  logger.info("")
  logger.info("─── Repair summary ───")
  logger.info(`parents_scanned        = ${byParent.size}`)
  logger.info(`completed              = ${completed}${dryRun ? " (DRY RUN)" : ""}`)
  logger.info(`output_backfilled      = ${outputBackfilled}${dryRun ? " (DRY RUN)" : ""} (already-completed parents whose produced_quantity was null)`)
  logger.info(`skipped_no_output      = ${skippedNoOutputAnywhere} (completed, produced null, and no child states any)`)
  logger.info(`skipped_children_open  = ${skippedNotAllDone}`)
  logger.info(`skipped_terminal       = ${skippedTerminal} (cancelled/other, not forced)`)
  logger.info(`errors                 = ${errors.length}`)

  if (errors.length) process.exitCode = 1
}
