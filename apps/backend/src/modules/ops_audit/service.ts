import { MedusaService } from "@medusajs/framework/utils"

import OpsMaintenanceRun from "./models/ops-maintenance-run"

/**
 * ops_audit module service — durable audit log for ops maintenance jobs (#457).
 * The generated `createOpsMaintenanceRuns` / `listAndCountOpsMaintenanceRuns`
 * are all we need.
 */
class OpsAuditService extends MedusaService({
  OpsMaintenanceRun,
}) {}

export default OpsAuditService
