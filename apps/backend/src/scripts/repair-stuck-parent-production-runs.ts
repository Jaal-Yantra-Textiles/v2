import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../modules/production_runs"
import type ProductionRunService from "../modules/production_runs/service"

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
  const errors: Array<{ parent_id: string; error: string }> = []

  for (const [parentId, kids] of byParent) {
    const allCompleted = kids.every((c) => String(c.status) === "completed")
    if (!allCompleted) {
      skippedNotAllDone++
      continue
    }

    const parent = (await service
      .retrieveProductionRun(parentId)
      .catch(() => null)) as any
    if (!parent) continue

    const status = String(parent.status)
    if (status === "completed") {
      continue // already correct
    }

    const isStuck = STUCK_STATUSES.includes(status)
    const isForced = forceIds.has(parentId)
    if (!isStuck && !isForced) {
      // e.g. cancelled and not explicitly forced.
      skippedTerminal++
      continue
    }

    // Reconcile totals from children.
    const sum = (key: string, fallback?: string) =>
      kids.reduce((acc, c) => {
        const v = c?.[key] ?? (fallback ? c?.[fallback] : undefined)
        return acc + (Number.isFinite(Number(v)) ? Number(v) : 0)
      }, 0)
    const quantityTotal = sum("quantity")
    const producedTotal = sum("produced_quantity", "quantity")
    const latestMs = kids
      .map((c) => c?.completed_at)
      .filter(Boolean)
      .map((d) => new Date(d).getTime())
      .reduce((a, b) => Math.max(a, b), 0)

    const tag = `parent ${parentId} (${status} → completed, qty ${parent.quantity}→${quantityTotal}, produced→${producedTotal})${isForced ? " [forced]" : ""}`

    if (dryRun) {
      logger.info(`WOULD complete ${tag}`)
      completed++
      continue
    }

    try {
      await service.updateProductionRuns({
        id: parentId,
        status: "completed" as any,
        completed_at: latestMs ? new Date(latestMs) : new Date(),
        cancelled_at: null,
        ...(quantityTotal > 0 ? { quantity: quantityTotal } : {}),
        ...(producedTotal > 0 ? { produced_quantity: producedTotal } : {}),
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
  logger.info(`skipped_children_open  = ${skippedNotAllDone}`)
  logger.info(`skipped_terminal       = ${skippedTerminal} (cancelled/other, not forced)`)
  logger.info(`errors                 = ${errors.length}`)

  if (errors.length) process.exitCode = 1
}
