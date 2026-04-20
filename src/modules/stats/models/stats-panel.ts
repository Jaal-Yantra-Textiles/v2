import { model } from "@medusajs/framework/utils"
import { StatsDashboard } from "./stats-dashboard"

export const StatsPanel = model.define("stats_panel", {
  id: model.id({ prefix: "panel" }).primaryKey(),

  dashboard: model.belongsTo(() => StatsDashboard, { mappedBy: "panels" }),

  name: model.text(),
  type: model.enum([
    "metric",
    "list",
    "table",
    "bar",
    "line",
    "area",
    "label",
  ]).default("metric"),

  x: model.number().default(0),
  y: model.number().default(0),
  width: model.number().default(4),
  height: model.number().default(3),

  operation_type: model.text(),
  operation_options: model.json().default({}),

  display: model.json().default({}),

  cache_ttl_seconds: model.number().nullable(),

  metadata: model.json().default({}),
})
.indexes([
  { on: ["operation_type"], name: "idx_stats_panel_operation_type" },
])
