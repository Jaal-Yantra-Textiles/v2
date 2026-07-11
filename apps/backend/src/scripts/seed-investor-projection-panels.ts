import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STATS_MODULE } from "../modules/stats"

/**
 * Seeds the "Investor Projections" stats dashboard + its panels, each flagged
 * `metadata.investor === true` so the investor-ui Projections tab can read them
 * through the investor-scoped resolver (`GET /investors/stats/panels`).
 *
 * Idempotent: re-running updates the existing dashboard's panels in place
 * (matched by name) rather than duplicating them.
 *
 * Usage:
 *   npx medusa exec ./src/scripts/seed-investor-projection-panels.ts
 */
const DASHBOARD_NAME = "Investor Projections"

const PANELS = [
  {
    name: "GMV projection",
    type: "metric",
    x: 0, y: 0, width: 6, height: 2,
    operation_type: "gmv_projection",
    operation_options: { currency: "INR", window_days: 90 },
  },
  {
    name: "GMV trend",
    type: "area",
    x: 6, y: 0, width: 6, height: 2,
    operation_type: "time_series",
    operation_options: {
      entity: "marketing_metric_snapshot",
      dateField: "captured_for_date",
      filters: { metric_key: "platform_net_gmv" },
      aggregate: { fn: "sum", field: "value" },
      precision: "week",
      range: { last_days: 90 },
    },
  },
  {
    name: "Unique visitors (30d)",
    type: "line",
    x: 0, y: 2, width: 6, height: 2,
    operation_type: "time_series",
    operation_options: {
      entity: "analytics_daily_stats",
      dateField: "date",
      aggregate: { fn: "sum", field: "unique_visitors" },
      precision: "day",
      range: { last_days: 30 },
    },
  },
  {
    name: "Conversion rate (30d avg)",
    type: "metric",
    x: 6, y: 2, width: 6, height: 2,
    operation_type: "aggregate_data",
    operation_options: {
      entity: "marketing_metric_snapshot",
      dateField: "captured_for_date",
      filters: { metric_key: "storefront_conversion_rate" },
      aggregate: { fn: "avg", field: "value" },
      range: { last_days: 30 },
    },
  },
  {
    name: "Ads efficiency (30d)",
    type: "metric",
    x: 0, y: 4, width: 12, height: 2,
    operation_type: "ads_efficiency",
    operation_options: { last_days: 30, base_currency: "INR" },
  },
]

export default async function seedInvestorProjectionPanels({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const stats: any = container.resolve(STATS_MODULE)

  // Find or create the dashboard.
  const existing = await stats.listStatsDashboards({ name: DASHBOARD_NAME }, { take: 1 })
  let dashboard = (existing || [])[0]
  if (!dashboard) {
    ;[dashboard] = await stats.createStatsDashboards([
      {
        name: DASHBOARD_NAME,
        description: "Growth, marketing efficiency and valuation metrics shown to investors.",
        icon: "arrow-trending-up",
        color: "#3b82f6",
        metadata: { investor: true },
      },
    ])
    logger.info(`Created dashboard ${dashboard.id} (${DASHBOARD_NAME})`)
  } else {
    logger.info(`Reusing dashboard ${dashboard.id} (${DASHBOARD_NAME})`)
  }

  const currentPanels = await stats.listStatsPanels(
    { dashboard_id: dashboard.id },
    { take: 500 }
  )
  const byName = new Map<string, any>()
  for (const p of currentPanels || []) byName.set(p.name, p)

  for (const spec of PANELS) {
    const payload = {
      dashboard_id: dashboard.id,
      name: spec.name,
      type: spec.type,
      x: spec.x,
      y: spec.y,
      width: spec.width,
      height: spec.height,
      operation_type: spec.operation_type,
      operation_options: spec.operation_options,
      display: {},
      cache_ttl_seconds: 300,
      metadata: { investor: true },
    }

    const found = byName.get(spec.name)
    if (found) {
      await stats.updateStatsPanels({ id: found.id, ...payload })
      logger.info(`Updated panel "${spec.name}" (${found.id})`)
    } else {
      const [created] = await stats.createStatsPanels([payload])
      logger.info(`Created panel "${spec.name}" (${created.id})`)
    }
  }

  logger.info(
    `Investor projection panels seeded on dashboard ${dashboard.id}. ` +
      `They are visible at GET /investors/stats/panels.`
  )
}
