import { model } from "@medusajs/framework/utils"
import { VisualFlow } from "./visual-flow"

export const VisualFlowOperation = model.define("visual_flow_operation", {
  id: model.id({ prefix: "vfop" }).primaryKey(),
  
  // Relationship to flow
  flow: model.belongsTo(() => VisualFlow, { mappedBy: "operations" }),
  
  // Unique key within the flow for data chain references
  operation_key: model.text(),
  
  // Operation type — keep in sync with the DB CHECK constraint
  // (see migrations/Migration20260418100000.ts for the latest authoritative list).
  operation_type: model.enum([
    "condition",
    "create_data",
    "read_data",
    "update_data",
    "delete_data",
    "bulk_update_data",
    "bulk_create_data",
    "bulk_http_request",
    "bulk_trigger_workflow",
    "http_request",
    "run_script",
    "send_email",
    "send_whatsapp",
    "notification",
    "transform",
    "trigger_workflow",
    "trigger_flow",
    "execute_code",
    "sleep",
    "log",
    "ai_extract",
    "aggregate_product_analytics",
  ]),
  
  // Display name
  name: model.text().nullable(),
  
  // Operation-specific configuration
  options: model.json().default({}),
  
  // Canvas position
  position_x: model.float().default(0),
  position_y: model.float().default(0),
  
  // Execution order (for sequential execution within branches)
  sort_order: model.number().default(0),
  
  // Relationships
  logs: model.hasMany(() => require("./visual-flow-execution-log").VisualFlowExecutionLog, { mappedBy: "operation" }),
})
.indexes([
  { on: ["operation_key"], name: "idx_vf_operation_key" },
  { on: ["operation_type"], name: "idx_vf_operation_type" },
])
