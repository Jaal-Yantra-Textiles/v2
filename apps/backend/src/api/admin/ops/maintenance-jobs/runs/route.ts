import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { OPS_AUDIT_MODULE } from "../../../../../modules/ops_audit"
import { OpsMaintenanceRunsQuery } from "../validators"

/**
 * GET /admin/ops/maintenance-jobs/runs
 *
 * Durable history of maintenance-job runs (#457). Paginated, newest first,
 * filterable by job_id / dry_run / applied / batch_id. Sibling of `[id]/` so it
 * doesn't collide with the `:id/run` matcher. Mirrors the admin list-route
 * envelope: `{ runs, count, limit, offset }`.
 *
 * `batch_id` (#508): a parent batch id scopes to that batch's children; the
 * `"null"`/`"none"` sentinel scopes to single-job runs only (`batch_id IS NULL`)
 * — what the run-history "All runs" tab reads so batch children aren't shown
 * twice (once flat, once under their batch).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { limit, offset, job_id, dry_run, applied, batch_id } =
    req.validatedQuery as unknown as OpsMaintenanceRunsQuery

  const filters: Record<string, unknown> = {}
  if (job_id !== undefined) filters.job_id = job_id
  if (dry_run !== undefined) filters.dry_run = dry_run
  if (applied !== undefined) filters.applied = applied
  if (batch_id !== undefined) {
    // "null"/"none" → single-job runs only (IS NULL); else the exact parent id.
    filters.batch_id =
      batch_id === "null" || batch_id === "none" ? null : batch_id
  }

  const audit: any = req.scope.resolve(OPS_AUDIT_MODULE)
  const [runs, count] = await audit.listAndCountOpsMaintenanceRuns(filters, {
    skip: offset,
    take: limit,
    order: { created_at: "DESC" },
  })

  res.json({ runs, count, limit, offset })
}
