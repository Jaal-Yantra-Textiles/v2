import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { adminCompleteProductionRunWorkflow } from "../../../../../workflows/production-runs/admin-complete-production-run"
import { costTypeGuardMessage } from "../../../../../workflows/production-runs/lib/cost-type-guard"

const REJECTION_REASONS = [
  "stitching_defect",
  "fabric_flaw",
  "color_mismatch",
  "sizing_error",
  "print_defect",
  "material_damage",
  "quality_below_standard",
  "other",
] as const

const CompleteBodySchema = z.object({
  produced_quantity: z.number().min(0).optional(),
  rejected_quantity: z.number().min(0).optional(),
  rejection_reason: z.enum(REJECTION_REASONS).optional(),
  rejection_notes: z.string().optional(),
  partner_cost_estimate: z.number().positive().optional(),
  cost_type: z.enum(["per_unit", "total"]).optional(),
  notes: z.string().optional(),
  allow_shortfall: z.boolean().optional(),
  from_message_id: z.string().optional(),
  from_conversation_id: z.string().optional(),
})

/**
 * POST /admin/production-runs/:id/complete
 *
 * Admin-side completion of a production run, designed for the WhatsApp
 * messaging inbox flow: the partner sends a free-form message saying work
 * is done, and the admin completes the run from that message without
 * leaving the conversation view.
 *
 * The partner may never have formally accepted, started or finished the run
 * in the partner app — they said the work was done in a message — so the run
 * has to be brought to a completable state before
 * `completeProductionRunWorkflow`'s policy gate will pass.
 *
 * That override is NOT done here. `adminCompleteProductionRunWorkflow` decides
 * from the policy whether the run may be overridden at all BEFORE writing
 * anything, applies the change in a compensatable step, and runs the real
 * completion nested inside it — so a rejected completion leaves the run exactly
 * as it was rather than permanently claiming it was started and finished.
 * Doing it in this route meant a rejection was a corruption, not a no-op.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const runId = req.params.id
  const service: ProductionRunService = req.scope.resolve(PRODUCTION_RUNS_MODULE)

  const run = (await service.retrieveProductionRun(runId).catch(() => null)) as any
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Production run ${runId} not found`
    )
  }

  if (run.status === "cancelled") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Cannot complete a cancelled production run"
    )
  }

  if (run.status === "completed") {
    return res.json({
      production_run: run,
      message: "Production run is already completed",
    })
  }

  const parsed = CompleteBodySchema.safeParse(req.body)
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.issues.map((i) => i.message).join(", ")
    )
  }

  const body = parsed.data
  const adminActorId = (req as any).auth_context?.actor_id ?? null

  // Use the run's partner_id — the workflow validates ownership. Checked
  // before the workflow so a run with no partner is refused without a write.
  const partnerId = run.partner_id
  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This production run has no assigned partner and cannot be completed"
    )
  }

  // A per-piece rate stored as a total is paid once — #1554. The amount and
  // its type travel together or neither is accepted.
  const costTypeIssue = costTypeGuardMessage(body)
  if (costTypeIssue) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, costTypeIssue)
  }

  const { result, errors } = await adminCompleteProductionRunWorkflow(
    req.scope
  ).run({
    input: {
      production_run_id: runId,
      partner_id: partnerId,
      produced_quantity: body.produced_quantity,
      rejected_quantity: body.rejected_quantity,
      rejection_reason: body.rejection_reason,
      rejection_notes: body.rejection_notes,
      partner_cost_estimate: body.partner_cost_estimate,
      cost_type: body.cost_type,
      allow_shortfall: body.allow_shortfall,
      notes: body.notes,
      override_note: body.notes,
    },
    throwOnError: false,
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to complete production run: ${errors
          .map((e: any) => e?.error?.message || String(e))
          .join(", ")}`
      )
    )
  }

  const updated = await service.retrieveProductionRun(runId)

  // Audit: record that this completion originated from a WhatsApp message.
  try {
    await service.createProductionRunActivities({
      production_run_id: runId,
      activity_type: "note",
      kind: "completed_from_whatsapp",
      actor_type: "admin",
      actor_id: adminActorId,
      partner_id: partnerId,
      channel: body.from_message_id ? "whatsapp" : null,
      message_id: body.from_message_id ?? null,
      template_name: null,
      recipient: null,
      summary: body.notes
        ? `Run completed from WhatsApp message: "${body.notes.substring(0, 120)}"`
        : "Run completed from WhatsApp (admin)",
      payload: {
        from_message_id: body.from_message_id ?? null,
        from_conversation_id: body.from_conversation_id ?? null,
        produced_quantity: body.produced_quantity ?? null,
        rejected_quantity: body.rejected_quantity ?? null,
        source: "messaging_inbox",
      },
      occurred_at: new Date(),
    } as any)
  } catch {
    // Best-effort — the completion itself already succeeded.
  }

  const loggedCount = (result as any)?.consumptions?.logged_ids?.length || 0

  res.status(200).json({
    production_run: updated,
    consumptions_logged: loggedCount,
    message: "Production run completed",
  })
}
