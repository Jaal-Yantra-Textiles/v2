import { model } from "@medusajs/framework/utils"

export const VisualFlow = model.define("visual_flow", {
  id: model.id({ prefix: "vflow" }).primaryKey(),
  
  // Basic info
  name: model.text(),
  description: model.text().nullable(),
  
  // Status
  status: model.enum(["active", "inactive", "draft"]).default("draft"),
  
  // Visual customization
  icon: model.text().nullable(),
  color: model.text().nullable(),
  
  // Trigger configuration
  trigger_type: model.enum(["event", "schedule", "webhook", "manual", "another_flow"]),
  trigger_config: model.json().default({}),
  
  // Canvas state for React Flow (nodes positions, viewport, etc.)
  canvas_state: model.json().default({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),

  // Compiled execution plan (#459 P1). Derived from canvas_state/operations at
  // save time: normalized topological levels + per-node handlers/options +
  // branch handles. `compiled_plan.ok === false` carries validation errors for
  // an invalid graph (only blocks save when activating; drafts may be invalid).
  // `compiled_hash` keys the Redis plan cache.
  compiled_plan: model.json().nullable(),
  compiled_hash: model.text().nullable(),

  // Additional metadata
  metadata: model.json().default({}),
  
  // Relationships - defined as forward references to avoid circular imports
  operations: model.hasMany(() => require("./visual-flow-operation").VisualFlowOperation, { mappedBy: "flow" }),
  connections: model.hasMany(() => require("./visual-flow-connection").VisualFlowConnection, { mappedBy: "flow" }),
  executions: model.hasMany(() => require("./visual-flow-execution").VisualFlowExecution, { mappedBy: "flow" }),
})
.indexes([
  { on: ["status"], name: "idx_visual_flow_status" },
  { on: ["trigger_type"], name: "idx_visual_flow_trigger_type" },
])
