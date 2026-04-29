/**
 * Seed: Cart Recovery dashboard.
 *
 * Idempotent — skips if a dashboard with the same name already exists,
 * panels untouched. To re-seed with a different layout, delete the
 * existing dashboard from /admin/stats first.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-cart-recovery-dashboard.ts
 *
 * The panels here all use the new `cart_recovery_stats` operation —
 * `output: "summary"` for the metric cards (each picks its scalar via
 * display.field), `output: "intent_distribution"` for the bar, and
 * `output: "stamping_trend"` for the trend line. See
 * src/modules/visual_flows/operations/cart-recovery-stats.ts for the
 * exact response shape.
 */

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

const DASHBOARD_NAME = "Cart Recovery"

// Default to 30 days so the percentages aren't shaky at current
// ~30 carts/day volume. Operators can clone via
// POST /admin/stats/dashboards/:id/duplicate to create a 7-day variant.
const WINDOW_DAYS = 30

// Panels are heavier than typical aggregate_data calls because each
// resolve does a per-cart intent join. 5 minutes is a reasonable
// freshness vs cost trade. Per-panel refresh button bypasses cache.
const CACHE_TTL = 300

const PANELS: SeedPanel[] = [
  {
    name: `Carts created (${WINDOW_DAYS}d)`,
    type: "metric",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: WINDOW_DAYS, output: "summary" },
    display: { field: "total", label: "All non-completed carts in window" },
    width: 3,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "Stamped with visitor_id",
    type: "metric",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: WINDOW_DAYS, output: "summary" },
    display: {
      field: "with_visitor_id",
      label: "Carts linked to a browsing session",
    },
    width: 3,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "Stamping coverage",
    type: "metric",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: WINDOW_DAYS, output: "summary" },
    display: {
      field: "stamping_rate_pct",
      label: "% of new carts carrying visitor_id",
      suffix: "%",
    },
    width: 3,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "Has email",
    type: "metric",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: WINDOW_DAYS, output: "summary" },
    display: { field: "with_email", label: "Carts with an email already (recoverable today)" },
    width: 3,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "At checkout",
    type: "metric",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: WINDOW_DAYS, output: "summary" },
    display: { field: "at_checkout", label: "Carts that picked a region (reached checkout)" },
    width: 4,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "High-intent carts",
    type: "metric",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: WINDOW_DAYS, output: "summary" },
    display: { field: "high_intent", label: "Score ≥ 70 (modal-worthy if no email)" },
    width: 4,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "High-intent share",
    type: "metric",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: WINDOW_DAYS, output: "summary" },
    display: {
      field: "high_intent_pct",
      label: "% of stamped carts at high intent",
      suffix: "%",
    },
    width: 4,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "Intent distribution",
    type: "bar",
    operation_type: "cart_recovery_stats",
    operation_options: {
      last_days: WINDOW_DAYS,
      output: "intent_distribution",
    },
    display: { xAxis: "key", yAxis: "value" },
    width: 6,
    height: 4,
    cache_ttl_seconds: CACHE_TTL,
  },
  {
    name: "Stamping coverage trend",
    type: "line",
    operation_type: "cart_recovery_stats",
    operation_options: { last_days: 14, output: "stamping_trend" },
    display: { xAxis: "date", yAxis: "value", suffix: "%" },
    width: 6,
    height: 4,
    cache_ttl_seconds: CACHE_TTL,
  },
]

export default async function seedCartRecoveryDashboard({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: StatsService = container.resolve(STATS_MODULE)

  logger.info(`Seeding "${DASHBOARD_NAME}" dashboard...`)

  const [existing] = await service.listAndCountStatsDashboards({}, { take: 200 })
  const match = existing.find((d: any) => d.name === DASHBOARD_NAME)
  if (match) {
    logger.info(
      `  Dashboard "${DASHBOARD_NAME}" already exists (id=${match.id}) — skipping. Delete it from /admin/stats to re-seed.`,
    )
    return
  }

  const dashboard = await service.createStatsDashboards({
    name: DASHBOARD_NAME,
    description:
      "Coverage + intent metrics for cart recovery. Validates the visitor_id stamp on cart.metadata and shows the addressable population for an email-capture modal. Built on the cart_recovery_stats operation.",
  })

  // Lay out the grid: walk panels left-to-right, wrapping at width 12.
  let y = 0
  let rowX = 0
  let rowMaxHeight = 0
  const records: any[] = []
  PANELS.forEach((p, idx) => {
    const width = p.width ?? 4
    const height = p.height ?? 3
    if (rowX + width > 12) {
      y += rowMaxHeight
      rowX = 0
      rowMaxHeight = 0
    }
    records.push({
      dashboard_id: (dashboard as any).id,
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
    })
    rowX += width
    if (height > rowMaxHeight) rowMaxHeight = height
  })

  await service.createStatsPanels(records as any)

  logger.info(
    `  Created "${DASHBOARD_NAME}" (id=${(dashboard as any).id}) with ${records.length} panels.`,
  )
}
