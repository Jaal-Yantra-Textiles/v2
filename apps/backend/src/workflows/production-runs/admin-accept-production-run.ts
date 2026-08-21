/**
 * Admin: accept a production run on behalf of the assigned partner.
 *
 * Mirrors `acceptProductionRunWorkflow` but initiated by an admin rather
 * than the partner. The admin does not have a partner_id of their own, so
 * the workflow retrieves the run, validates it is actionable, and passes
 * `run.partner_id` to the existing partner accept workflow — the same
 * delegation pattern as `adminCompleteProductionRunWorkflow`.
 *
 * The existing partner workflow handles: policy assertion (`assertCanAccept`),
 * status → in_progress, `accepted_at` stamp, parent-run promotion, unified
 * order mirror, and the `production_run.accepted` event. This workflow
 * wraps it and records an admin activity audit entry.
 */
import { transform, WorkflowResponse, createWorkflow } from "@medusajs/framework/workflows-sdk"

import { acceptProductionRunWorkflow } from "./accept-production-run"
import {
  retrieveAndValidateAdminRunStep,
  recordAdminRunActivityStep,
  type AdminRunInput,
} from "./admin-run-steps"

export type AdminAcceptProductionRunInput = AdminRunInput & {
  admin_actor_id?: string | null
}

export const adminAcceptProductionRunWorkflow = createWorkflow(
  "admin-accept-production-run",
  function (input: AdminAcceptProductionRunInput) {
    const run = retrieveAndValidateAdminRunStep({
      production_run_id: input.production_run_id,
      opts: { action: "accept" },
    })

    const nestedInput = transform({ run }, (data) => ({
      production_run_id: data.run.id,
      partner_id: data.run.partner_id,
    }))

    const result = acceptProductionRunWorkflow.runAsStep({ input: nestedInput })

    recordAdminRunActivityStep({
      production_run_id: input.production_run_id,
      partner_id: run.partner_id,
      admin_actor_id: input.admin_actor_id ?? null,
      kind: "accepted_by_admin",
      summary: "Production run accepted by admin on behalf of partner",
      payload: { source: "admin_override" },
    })

    return new WorkflowResponse(result)
  }
)
