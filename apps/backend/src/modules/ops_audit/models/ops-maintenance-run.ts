import { model } from "@medusajs/framework/utils"

/**
 * Durable audit record for one `POST /admin/ops/maintenance-jobs/:id/run` call
 * (both dry-run previews and applies). #457.
 *
 * Low-volume, operator-driven rows (not request-path), so we store the FULL
 * before/after `changes` JSON — fidelity > size. `created_at` (auto) is the run
 * time; no separate `ran_at` column needed.
 */
const OpsMaintenanceRun = model.define("ops_maintenance_run", {
  id: model.id().primaryKey(),
  job_id: model.text(),
  actor_id: model.text(),
  dry_run: model.boolean(),
  applied: model.boolean(),
  change_count: model.number(),
  error_count: model.number(),
  summary: model.text(),
  params: model.json(),
  changes: model.json(),
  errors: model.json(),
})

export default OpsMaintenanceRun
