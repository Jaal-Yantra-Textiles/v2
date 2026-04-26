import { model } from "@medusajs/framework/utils"
import { VisualFlow } from "./visual-flow"

export const VisualFlowConnection = model.define("visual_flow_connection", {
  id: model.id({ prefix: "vfcon" }).primaryKey(),
  
  // Relationship to flow
  flow: model.belongsTo(() => VisualFlow, { mappedBy: "connections" }),
  
  // Source: operation ID or "trigger" for the flow trigger
  source_id: model.text(),
  
  // Source handle (for operations with multiple outputs like condition)
  source_handle: model.text().default("default"),
  
  // Target operation ID
  target_id: model.text(),
  
  // Target handle
  target_handle: model.text().default("default"),
  
  // Connection type
  connection_type: model.enum(["success", "failure", "default"]).default("default"),
  
  // Optional condition for this connection path
  condition: model.json().nullable(),
  
  // Visual styling
  label: model.text().nullable(),
  style: model.json().nullable(),
})
.indexes([
  { on: ["source_id"], name: "idx_vf_connection_source" },
  { on: ["target_id"], name: "idx_vf_connection_target" },
])
