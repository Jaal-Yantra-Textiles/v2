import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { PRODUCTION_POLICY_MODULE } from "../../../../../modules/production_policy"
import type ProductionPolicyService from "../../../../../modules/production_policy/service"
import { declineProductionRunWorkflow } from "../../../../../workflows/production-runs/decline-production-run"

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

  // Fetch + ownership / state guards (kept in the route so they surface as
  // clean HTTP errors; the mutations live in declineProductionRunWorkflow).
  let run: any
  try {
    run = await productionRunService.retrieveProductionRun(id)
  } catch {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Production run not found")
  }

  if (run.partner_id !== partnerId) {
    // Surface as NOT_FOUND so we don't leak that the run exists to a
    // partner it isn't assigned to. Maps to 404 via Medusa's error handler.
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Production run not found")
  }
  if (run.status === "cancelled") {
    return res.json({ production_run: run, message: "Already cancelled" })
  }
  // Transition rules live in ProductionPolicyService: completed runs and
  // runs with started work can't be partner-declined (admin cancel is the
  // mid-flight path).
  const productionPolicyService: ProductionPolicyService = req.scope.resolve(
    PRODUCTION_POLICY_MODULE
  )
  await productionPolicyService.assertCanDecline(run)

  // Compose a clear attribution string so admin feed / inspection tells
  // the partner vs admin story at a glance.
  const reasonLabel = REASON_LABELS[reason]
  const composedReason = notes
    ? `Declined by partner (${reasonLabel}): ${notes}`
    : `Declined by partner (${reasonLabel})`

  await declineProductionRunWorkflow(req.scope).run({
    input: {
      production_run_id: id,
      partner_id: partnerId,
      composed_reason: composedReason,
      reason,
      notes,
    },
  })

  const final = await productionRunService.retrieveProductionRun(id)
  return res.json({
    production_run: final,
    message: `Production run declined (${reasonLabel})`,
  })
}
