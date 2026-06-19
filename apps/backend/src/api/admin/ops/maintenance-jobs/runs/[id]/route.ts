import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { OPS_AUDIT_MODULE } from "../../../../../../modules/ops_audit"

/**
 * GET /admin/ops/maintenance-jobs/runs/:id
 *
 * Per-run detail (Data Plumbing v2, #508). One persisted `ops_maintenance_run`
 * row, carrying its own per-entity `changes`/`errors` and (when it ran inside a
 * batch) its `batch_id`/`job_index`. Backs the deep-linkable run detail route
 * the Data Plumbing history table drills into. 404 if the run id is unknown.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const audit: any = req.scope.resolve(OPS_AUDIT_MODULE)

  let run: any
  try {
    run = await audit.retrieveOpsMaintenanceRun(id)
  } catch {
    run = null
  }
  if (!run) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Maintenance run '${id}' not found`
    )
  }

  res.json({ run })
}
