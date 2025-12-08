import { model } from "@medusajs/framework/utils"
import { VisualFlowExecution } from "./visual-flow-execution"
import { VisualFlowOperation } from "./visual-flow-operation"

export const VisualFlowExecutionLog = model.define("visual_flow_execution_log", {
  id: model.id({ prefix: "vflog" }).primaryKey(),
  
  // Relationship to execution
  execution: model.belongsTo(() => VisualFlowExecution, { mappedBy: "logs" }),
  
  // Optional relationship to operation (null for trigger logs)
  operation: model.belongsTo(() => VisualFlowOperation, { mappedBy: "logs" }).nullable(),
  
  // Operation key for reference (or "trigger")
  operation_key: model.text(),
  
  // Execution status for this step
  status: model.enum(["success", "failure", "skipped", "running"]),
  
  // Input data passed to this operation
  input_data: model.json().nullable(),
  
  // Output data returned by this operation
  output_data: model.json().nullable(),
  
  // Error information if failed
  error: model.text().nullable(),
  error_stack: model.text().nullable(),
  
  // Timing
  duration_ms: model.number().nullable(),
  executed_at: model.dateTime(),
})
.indexes([
  { on: ["operation_key"], name: "idx_vf_log_operation_key" },
  { on: ["status"], name: "idx_vf_log_status" },
  { on: ["executed_at"], name: "idx_vf_log_executed_at" },
])
