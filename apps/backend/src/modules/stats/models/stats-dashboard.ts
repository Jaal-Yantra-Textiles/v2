import { model } from "@medusajs/framework/utils"

export const StatsDashboard = model.define("stats_dashboard", {
  id: model.id({ prefix: "dash" }).primaryKey(),

  name: model.text(),
  description: model.text().nullable(),

  icon: model.text().nullable(),
  color: model.text().nullable(),

  metadata: model.json().default({}),

  panels: model.hasMany(
    () => require("./stats-panel").StatsPanel,
    { mappedBy: "dashboard" }
  ),
})
.indexes([
  { on: ["name"], name: "idx_stats_dashboard_name" },
])
