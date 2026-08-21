import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { PRODUCTION_RUNS_MODULE } from "../../../../../modules/production_runs"
import type ProductionRunService from "../../../../../modules/production_runs/service"
import { adminFinishProductionRunWorkflow } from "../../../../../workflows/production-runs/admin-finish-production-run"

/**
 * POST /admin/production-runs/:id/finish
 *
 * Admin-side finish of a production run on behalf of the assigned partner.
 * Mirrors POST /partners/production-runs/:id/finish but initiated by an
 * admin. The workflow retrieves the run, validates it is actionable, and
 * delegates to the existing `finishProductionRunWorkflow` (policy gate,
 * finished_at + finish_notes stamp, design status transition, lifecycle
 * signal, unified order mirror) — then records an admin activity audit
 * entry.
 *
 * Body:
 *   notes?: string — free-form notes recorded as `finish_notes`
 */
export const POST = async (
  req: AuthenticatedMedusaRequest & { params: { id: string } },
  res: MedusaResponse
) => {
  const body = (req as any).validatedBody || req.body || {}
  const notes =
    typeof body.notes === "string" ? body.notes.trim().slice(0, 1000) : undefined

  const { result, errors } = await adminFinishProductionRunWorkflow(
    req.scope
  ).run({
    input: {
      production_run_id: req.params.id,
      admin_actor_id: (req as any).auth_context?.actor_id ?? null,
      notes,
    },
    throwOnError: false,
  })

  if (errors?.length) {
    throw (
      errors[0].error ||
      new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Failed to finish production run: ${errors
          .map((e: any) => e?.error?.message || String(e))
          .join(", ")}`
      )
    )
  }

  const service: ProductionRunService =
    req.scope.resolve(PRODUCTION_RUNS_MODULE)
  const updated = await service.retrieveProductionRun(req.params.id)

  res.status(200).json({
    production_run: updated,
    message: "Production run finished",
  })
}
