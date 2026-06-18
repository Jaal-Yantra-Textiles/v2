import { Module } from "@medusajs/framework/utils"

import OpsAuditService from "./service"

export const OPS_AUDIT_MODULE = "ops_audit"

export default Module(OPS_AUDIT_MODULE, {
  service: OpsAuditService,
})
