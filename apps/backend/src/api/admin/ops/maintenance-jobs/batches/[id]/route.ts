import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

import { OPS_AUDIT_MODULE } from "../../../../../../modules/ops_audit"

/**
 * GET /admin/ops/maintenance-jobs/batches/:id
 *
 * Per-batch detail (Data Plumbing v2, #508): one `ops_maintenance_batch` parent
 * (its persisted rollup) plus its child `ops_maintenance_run` rows, ordered by
 * `job_index` (the order the jobs ran in the batch). Drills in from the batch
 * history index (`GET /admin/ops/maintenance-jobs/batches`). 404 if the batch id
 * is unknown. The children carry their own per-entity `changes`/`errors`, so the
 * UI can render the grouped/card ↔ table views without a second call.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params

  const audit: any = req.scope.resolve(OPS_AUDIT_MODULE)

  let batch: any
  try {
    batch = await audit.retrieveOpsMaintenanceBatch(id)
  } catch {
    batch = null
  }
  if (!batch) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Maintenance batch '${id}' not found`
    )
  }

  // Child runs in batch order. The batch parent stores the rollup, so this is a
  // straight read of the linked children (no re-aggregation).
  const jobs = await audit.listOpsMaintenanceRuns(
    { batch_id: id },
    { order: { job_index: "ASC" } }
  )

  res.json({ batch, jobs })
}
