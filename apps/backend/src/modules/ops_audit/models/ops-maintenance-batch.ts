import { model } from "@medusajs/framework/utils"

/**
 * Durable parent record for one batch run — a single
 * `POST /admin/ops/maintenance-jobs/batches` call that runs several guarded
 * jobs sequentially under one named run (Data Plumbing v2, #508).
 *
 * One batch row per call (both dry-run previews and applies). Child results are
 * `ops_maintenance_run` rows carrying this row's `id` in their `batch_id`. The
 * batch persists its own rollup so the history list never re-aggregates the
 * children. Legacy single-job runs stay `batch_id = null` and are unaffected.
 */
const OpsMaintenanceBatch = model.define("ops_maintenance_batch", {
  id: model.id().primaryKey(),
  name: model.text(),
  actor_id: model.text(),
  dry_run: model.boolean(),
  stop_on_error: model.boolean(),
  job_count: model.number(),
  applied_count: model.number(),
  failed_count: model.number(),
  change_count: model.number(),
  error_count: model.number(),
  summary: model.text(),
})

export default OpsMaintenanceBatch
