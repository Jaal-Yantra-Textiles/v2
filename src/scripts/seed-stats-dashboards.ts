import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STATS_MODULE } from "../modules/stats"
import StatsService from "../modules/stats/service"

type SeedPanel = {
  name: string
  type: "metric" | "list" | "table" | "bar" | "line" | "area" | "label"
  operation_type: string
  operation_options: Record<string, any>
  display?: Record<string, any>
  width?: number
  height?: number
  cache_ttl_seconds?: number | null
}

type SeedDashboard = {
  name: string
  description: string
  panels: SeedPanel[]
}

const DASHBOARDS: SeedDashboard[] = [
  {
    name: "JYT Overview",
    description:
      "Top-line numbers for partners, designs, orders, and website traffic. Safe to port to prod.",
    panels: [
      {
        name: "Total partners",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "partner",
          aggregate: { fn: "count" },
        },
        display: { label: "Total partners" },
        width: 3,
        cache_ttl_seconds: 300,
      },
      {
        name: "Active partners",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "partner",
          aggregate: { fn: "count" },
          filters: { status: "active" },
        },
        display: { label: "Active partners" },
        width: 3,
        cache_ttl_seconds: 300,
      },
      {
        name: "Total designs",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "design",
          aggregate: { fn: "count" },
        },
        display: { label: "All designs" },
        width: 3,
        cache_ttl_seconds: 300,
      },
      {
        name: "Inventory orders",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "inventory_orders",
          aggregate: { fn: "count" },
        },
        display: { label: "Inventory orders" },
        width: 3,
        cache_ttl_seconds: 300,
      },
      {
        name: "Partners by status",
        type: "bar",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "partner",
          aggregate: { fn: "count" },
          groupBy: "status",
          limit: 10,
        },
        display: { xAxis: "key", yAxis: "value" },
        width: 6,
        height: 4,
        cache_ttl_seconds: 600,
      },
      {
        name: "Designs by status",
        type: "bar",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "design",
          aggregate: { fn: "count" },
          groupBy: "status",
          limit: 10,
        },
        display: { xAxis: "key", yAxis: "value" },
        width: 6,
        height: 4,
        cache_ttl_seconds: 600,
      },
      {
        name: "Website sessions (last 30 days)",
        type: "area",
        operation_type: "time_series",
        operation_options: {
          entity: "analytics_daily_stats",
          dateField: "date",
          aggregate: { fn: "sum", field: "sessions" },
          precision: "day",
          range: { last_days: 30 },
        },
        display: { xAxis: "date", yAxis: "value" },
        width: 12,
        height: 5,
        cache_ttl_seconds: 600,
      },
    ],
  },
  {
    name: "Partners & Production",
    description:
      "Partner-focused view — production runs, inventory orders per partner, verification status.",
    panels: [
      {
        name: "Verified partners",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "partner",
          aggregate: { fn: "count" },
          filters: { is_verified: true },
        },
        display: { label: "Verified partners" },
        width: 3,
      },
      {
        name: "Production runs",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "production_runs",
          aggregate: { fn: "count" },
        },
        display: { label: "Production runs" },
        width: 3,
      },
      {
        name: "Production runs by status",
        type: "bar",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "production_runs",
          aggregate: { fn: "count" },
          groupBy: "status",
          limit: 15,
        },
        display: { xAxis: "key", yAxis: "value" },
        width: 6,
        height: 4,
      },
      {
        name: "New production runs (30 days)",
        type: "line",
        operation_type: "time_series",
        operation_options: {
          entity: "production_runs",
          dateField: "created_at",
          aggregate: { fn: "count" },
          precision: "day",
          range: { last_days: 30 },
        },
        display: { xAxis: "date", yAxis: "value" },
        width: 12,
        height: 5,
      },
    ],
  },
  {
    name: "Website Traffic",
    description:
      "Daily rollups from the analytics module — visitors, bounce rate, device mix.",
    panels: [
      {
        name: "Unique visitors (30 days)",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "analytics_daily_stats",
          aggregate: { fn: "sum", field: "unique_visitors" },
        },
        display: { label: "Unique visitors (all-time rollups)" },
        width: 4,
      },
      {
        name: "Total pageviews",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "analytics_daily_stats",
          aggregate: { fn: "sum", field: "pageviews" },
        },
        display: { label: "Pageviews" },
        width: 4,
      },
      {
        name: "Avg bounce rate",
        type: "metric",
        operation_type: "aggregate_data",
        operation_options: {
          entity: "analytics_daily_stats",
          aggregate: { fn: "avg", field: "bounce_rate" },
        },
        display: { label: "Bounce rate", suffix: "%", decimals: 1 },
        width: 4,
      },
      {
        name: "Daily pageviews (30 days)",
        type: "line",
        operation_type: "time_series",
        operation_options: {
          entity: "analytics_daily_stats",
          dateField: "date",
          aggregate: { fn: "sum", field: "pageviews" },
          precision: "day",
          range: { last_days: 30 },
        },
        display: { xAxis: "date", yAxis: "value" },
        width: 12,
        height: 5,
      },
      {
        name: "Sessions by device (30 days)",
        type: "area",
        operation_type: "time_series",
        operation_options: {
          entity: "analytics_daily_stats",
          dateField: "date",
          aggregate: { fn: "sum", field: "sessions" },
          precision: "day",
          range: { last_days: 30 },
        },
        display: { xAxis: "date", yAxis: "value" },
        width: 12,
        height: 5,
      },
    ],
  },
]

export default async function seedStatsDashboards({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: StatsService = container.resolve(STATS_MODULE)

  logger.info("Seeding stats dashboards...")

  const [existing] = await service.listAndCountStatsDashboards({}, { take: 200 })
  const existingByName = new Map<string, any>(existing.map((d: any) => [d.name, d]))

  let createdDashboards = 0
  let createdPanels = 0
  let skippedDashboards = 0

  for (const dash of DASHBOARDS) {
    if (existingByName.has(dash.name)) {
      logger.info(`  Dashboard "${dash.name}" already exists — skipping (panels not touched).`)
      skippedDashboards++
      continue
    }

    const created = await service.createStatsDashboards({
      name: dash.name,
      description: dash.description,
    })

    if (dash.panels.length > 0) {
      let y = 0
      let rowX = 0
      const panelRecords = dash.panels.map((p, idx) => {
        const width = p.width ?? 4
        const height = p.height ?? 3
        if (rowX + width > 12) {
          rowX = 0
          y += height
        }
        const panel = {
          dashboard_id: created.id,
          name: p.name,
          type: p.type,
          x: rowX,
          y,
          width,
          height,
          operation_type: p.operation_type,
          operation_options: p.operation_options,
          display: p.display ?? {},
          cache_ttl_seconds: p.cache_ttl_seconds ?? null,
          metadata: { seed_index: idx },
        }
        rowX += width
        return panel
      })

      await service.createStatsPanels(panelRecords as any)
      createdPanels += panelRecords.length
    }

    logger.info(
      `  Created "${dash.name}" (${dash.panels.length} panel${dash.panels.length === 1 ? "" : "s"})`
    )
    createdDashboards++
  }

  logger.info(
    `Stats dashboards seeded. Created: ${createdDashboards} dashboards, ${createdPanels} panels. Skipped: ${skippedDashboards}.`
  )
}
