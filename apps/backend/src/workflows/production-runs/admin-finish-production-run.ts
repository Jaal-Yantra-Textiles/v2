/**
 * Admin: finish a production run on behalf of the assigned partner.
 *
 * Mirrors `finishProductionRunWorkflow` but initiated by an admin. Retrieves
 * the run, validates it is actionable, and passes `run.partner_id` (plus
 * optional notes) to the existing partner finish workflow.
 *
 * The existing partner workflow handles: policy assertion
 * (`assertCanFinishWork`), `finished_at` + `finish_notes` stamp, design
 * status transition (Revision), lifecycle workflow signal, unified order
 * mirror, and the `production_run.finished` event. This workflow wraps
 * it and records an admin activity audit entry.
 */
import { transform, WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"

import { finishProductionRunWorkflow } from "./finish-production-run"
import {
  retrieveAndValidateAdminRunStep,
  recordAdminRunActivityStep,
  type AdminRunInput,
} from "./admin-run-steps"

export type AdminFinishProductionRunInput = AdminRunInput & {
  admin_actor_id?: string | null
  notes?: string
}

export const adminFinishProductionRunWorkflow = createWorkflow(
  "admin-finish-production-run",
  function (input: AdminFinishProductionRunInput) {
    const run = retrieveAndValidateAdminRunStep({
      production_run_id: input.production_run_id,
      opts: { action: "finish" },
    })

    const nestedInput = transform(
      { run, notes: input.notes },
      (data) => ({
        production_run_id: data.run.id,
        partner_id: data.run.partner_id,
        notes: data.notes,
      })
    )

    const result = finishProductionRunWorkflow.runAsStep({ input: nestedInput })

    const activityInput = transform(
      { input, run },
      (data) => ({
        production_run_id: data.input.production_run_id,
        partner_id: data.run.partner_id,
        admin_actor_id: data.input.admin_actor_id ?? null,
        kind: "finished_by_admin",
        summary: data.input.notes
          ? `Production run finished by admin on behalf of partner: "${data.input.notes.substring(0, 120)}"`
          : "Production run finished by admin on behalf of partner",
        payload: { source: "admin_override", notes: data.input.notes ?? null },
      })
    )

    recordAdminRunActivityStep(activityInput)

    return new WorkflowResponse(result)
  }
)
