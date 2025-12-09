import { model } from "@medusajs/framework/utils"
import { VisualFlow } from "./visual-flow"

export const VisualFlowExecution = model.define("visual_flow_execution", {
  id: model.id({ prefix: "vfexec" }).primaryKey(),
  
  // Relationship to flow
  flow: model.belongsTo(() => VisualFlow, { mappedBy: "executions" }),
  
  // Execution status
  status: model.enum(["pending", "running", "completed", "failed", "cancelled"]).default("pending"),
  
  // Trigger data that started this execution
  trigger_data: model.json().default({}),
  
  // Accumulated data chain
  data_chain: model.json().default({}),
  
  // Timing
  started_at: model.dateTime().nullable(),
  completed_at: model.dateTime().nullable(),
  
  // Error information
  error: model.text().nullable(),
  error_details: model.json().nullable(),
  
  // Who/what triggered this execution
  triggered_by: model.text().nullable(), // user_id or "webhook" or "schedule"
  
  // Additional metadata
  metadata: model.json().default({}),
  
  // Relationships
  logs: model.hasMany(() => require("./visual-flow-execution-log").VisualFlowExecutionLog, { mappedBy: "execution" }),
})
.indexes([
  { on: ["status"], name: "idx_vf_execution_status" },
  { on: ["started_at"], name: "idx_vf_execution_started" },
])
