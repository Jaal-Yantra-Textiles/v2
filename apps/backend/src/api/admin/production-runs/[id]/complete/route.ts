import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { completeProductionRunWorkflow } from "../../../../../workflows/production-runs/complete-production-run"

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
 * The completion workflow (`completeProductionRunWorkflow`) validates that
 * the calling partner owns the run and that the run is in a completable
 * state (`assertCanCompleteWork` — requires `in_progress` + `finished_at`).
 * In the WhatsApp-driven flow the partner may never have formally "finished"
 * the run through the partner app, so this route applies an admin override
 * first: if `started_at` / `finished_at` are missing they are stamped now
 * so the workflow's policy gate passes. The workflow then handles stocking,
 * task completion, design cost update, parent cascade and event emission
 * exactly as a partner-initiated completion would.
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

  // Admin override: stamp lifecycle timestamps the partner may have skipped
  // so the workflow's policy gate (`assertCanCompleteWork`) passes. The
  // partner told the admin via WhatsApp that the work is done — that IS the
  // finish signal — so recording it now is faithful, not fabricated.
  const adminActorId = (req as any).auth_context?.actor_id ?? null
  const now = new Date()

  if (!run.started_at) {
    await service.updateProductionRuns({ id: runId, started_at: now })
  }
  if (!run.finished_at) {
    await service.updateProductionRuns({
      id: runId,
      finished_at: now,
      finish_notes: body.notes
        ? `Completed via WhatsApp — partner message: ${body.notes.substring(0, 200)}`
        : "Completed via WhatsApp (admin override)",
    })
  }

  // Use the run's partner_id — the workflow validates ownership.
  const partnerId = run.partner_id
  if (!partnerId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "This production run has no assigned partner and cannot be completed"
    )
  }

  const { result, errors } = await completeProductionRunWorkflow(req.scope).run({
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
    },
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
