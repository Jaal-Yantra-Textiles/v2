import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { TASKS_MODULE } from "../../../../../modules/tasks"

/**
 * POST /partners/production-runs/:id/decline
 *
 * Lets a partner refuse a run they've been assigned before they've started
 * working on it. Intended for capacity/materials/scheduling conflicts
 * surfaced via the WhatsApp "Decline" button or the `decline` text command.
 *
 * Guards:
 *   - Partner must own the run (partner_id match)
 *   - Run must be in a pre-work state (not started, not completed, not
 *     already cancelled). `started_at` being set means real work began,
 *     which makes this a mid-flight cancellation — that path stays admin-only.
 *
 * Side effects:
 *   - Status → "cancelled" with `cancelled_reason` prefixed so admin feed
 *     clearly attributes the action to the partner, not an admin
 *   - Linked tasks cancelled (mirrors admin cancel behaviour)
 *   - Emits `production_run.declined` (new) AND `production_run.cancelled`
 *     (reuses existing WhatsApp partner-notifications subscriber + admin
 *     feed), so no new subscriber is needed to get an audit trail today.
 */

const ALLOWED_REASONS = ["capacity", "materials_unavailable", "scheduling_conflict", "other"] as const
type DeclineReason = (typeof ALLOWED_REASONS)[number]

const REASON_LABELS: Record<DeclineReason, string> = {
  capacity: "No capacity / unavailable",
  materials_unavailable: "Required materials unavailable",
  scheduling_conflict: "Scheduling conflict",
  other: "Other",
}

export async function POST(
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) {
  const partnerId = req.auth_context?.actor_id
  if (!partnerId) {
    return res.status(401).json({ error: "Partner authentication required - no actor ID" })
  }

  const { id } = req.params
  const body = ((req as any).validatedBody ?? req.body ?? {}) as {
    reason?: string
    notes?: string
  }

  const reason = (body.reason ?? "other") as DeclineReason
  if (!ALLOWED_REASONS.includes(reason)) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Invalid reason. Allowed: ${ALLOWED_REASONS.join(", ")}`
    )
  }
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : undefined

  const productionRunService: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const taskService = req.scope.resolve(TASKS_MODULE) as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  // Fetch + ownership / state guards
  let run: any
  try {
    run = await productionRunService.retrieveProductionRun(id)
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Production run not found")
  }

  if (run.partner_id !== partnerId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This production run is not assigned to your partner account"
    )
  }
  if (run.status === "cancelled") {
    return res.json({ production_run: run, message: "Already cancelled" })
  }
  if (run.status === "completed") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot decline a completed production run"
    )
  }
  if (run.started_at) {
    // Work has begun — partner can't unilaterally back out. Admin cancel
    // is the right path, and an admin may need to handle partial costs.
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Work has already started on this run. Contact admin to cancel mid-production."
    )
  }

  // Compose a clear attribution string so admin feed / inspection tells
  // the partner vs admin story at a glance.
  const reasonLabel = REASON_LABELS[reason]
  const composedReason = notes
    ? `Declined by partner (${reasonLabel}): ${notes}`
    : `Declined by partner (${reasonLabel})`

  await productionRunService.updateProductionRuns({
    id,
    status: "cancelled",
    cancelled_at: new Date(),
    cancelled_reason: composedReason,
  })

  // Cancel linked tasks (mirrors admin cancel flow)
  try {
    const { data: runData } = await query.graph({
      entity: "production_runs",
      fields: ["tasks.id", "tasks.status"],
      filters: { id },
    })
    const tasks = runData?.[0]?.tasks || []
    for (const task of tasks) {
      if (task.status !== "completed" && task.status !== "cancelled") {
        await taskService.updateTasks({ id: task.id, status: "cancelled" })
      }
    }
  } catch (e: any) {
    console.error(`[decline-production-run] Failed to cancel tasks for ${id}:`, e.message)
  }

  // Emit both events:
  //   - production_run.declined → specific, for future partner-initiated handlers
  //   - production_run.cancelled → reuses existing subscribers (admin feed +
  //     WhatsApp "cancelled" template) so the partner gets a receipt today
  //     without requiring a new subscriber.
  try {
    const eventService = req.scope.resolve(Modules.EVENT_BUS) as any
    await eventService.emit([
      {
        name: "production_run.declined",
        data: {
          id,
          production_run_id: id,
          partner_id: partnerId,
          action: "declined",
          reason,
          notes,
        },
      },
      {
        name: "production_run.cancelled",
        data: {
          id,
          production_run_id: id,
          partner_id: partnerId,
          action: "cancelled",
          notes: composedReason,
        },
      },
    ])
  } catch { /* non-fatal */ }

  const final = await productionRunService.retrieveProductionRun(id)
  return res.json({
    production_run: final,
    message: `Production run declined (${reasonLabel})`,
  })
}
