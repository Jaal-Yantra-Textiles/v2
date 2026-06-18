import { MedusaService } from "@medusajs/framework/utils"

import OpsMaintenanceBatch from "./models/ops-maintenance-batch"
import OpsMaintenanceRun from "./models/ops-maintenance-run"

/**
 * ops_audit module service — durable audit log for ops maintenance jobs (#457).
 * The generated `createOpsMaintenanceRuns` / `listAndCountOpsMaintenanceRuns`
 * cover single-job runs; `createOpsMaintenanceBatches` /
 * `listAndCountOpsMaintenanceBatches` cover batch runs (Data Plumbing v2, #508).
 */
class OpsAuditService extends MedusaService({
  OpsMaintenanceBatch,
  OpsMaintenanceRun,
}) {}

export default OpsAuditService
