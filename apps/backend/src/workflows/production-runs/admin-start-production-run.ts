/**
 * Admin: start a production run on behalf of the assigned partner.
 *
 * Mirrors `startProductionRunWorkflow` but initiated by an admin. Retrieves
 * the run, validates it is actionable, and passes `run.partner_id` to the
 * existing partner start workflow.
 *
 * The existing partner workflow handles: policy assertion
 * (`assertCanStartWork`), `started_at` stamp, design status transition
 * (Sample_Production / In_Development), lifecycle workflow signal,
 * unified order mirror, and the `production_run.started` event. This
 * workflow wraps it and records an admin activity audit entry.
 */
import { transform, WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"

import { startProductionRunWorkflow } from "./start-production-run"
import {
  retrieveAndValidateAdminRunStep,
  recordAdminRunActivityStep,
  type AdminRunInput,
} from "./admin-run-steps"

export type AdminStartProductionRunInput = AdminRunInput & {
  admin_actor_id?: string | null
}

export const adminStartProductionRunWorkflow = createWorkflow(
  "admin-start-production-run",
  function (input: AdminStartProductionRunInput) {
    const run = retrieveAndValidateAdminRunStep({
      production_run_id: input.production_run_id,
      opts: { action: "start" },
    })

    const nestedInput = transform({ run }, (data) => ({
      production_run_id: data.run.id,
      partner_id: data.run.partner_id,
    }))

    const result = startProductionRunWorkflow.runAsStep({ input: nestedInput })

    recordAdminRunActivityStep({
      production_run_id: input.production_run_id,
      partner_id: run.partner_id,
      admin_actor_id: input.admin_actor_id ?? null,
      kind: "started_by_admin",
      summary: "Production run started by admin on behalf of partner",
      payload: { source: "admin_override" },
    })

    return new WorkflowResponse(result)
  }
)
