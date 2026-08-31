import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { STATS_MODULE } from "../modules/stats"

/**
 * Seeds the "Platform Stats" dashboard + its panel.
 *
 * The panel uses the DYNAMIC `metric_sections` operation: the metric keys are
 * declarative panel config (operation_options.sections), not hardcoded code.
 * Adding a new section = editing this panel's options — no code change.
 * Seeded sections, all derived from live rows only (the `trailing` windows
 * follow the panel's `window_days`):
 *   orders       { processed, trailing, window_days }
 *   commission   { accrued, trailing, currency, window_days }
 *   arr          { amount, currency }
 *   aov          { amount, currency }
 *   subscription { paying_artisans, mrr, currency }
 *
 * The panel is seeded PUBLIC (`metadata.public === true`) — the explicit
 * opt-in gate required by `GET /web/stats/panels/:id/data` — so marketing
 * site / blog embeds can read it without auth. Remove `metadata.public` to
 * make it private again (the public endpoint then 404s it).
 *
 * Idempotent: re-running updates the existing dashboard + panel in place
 * (matched by name) rather than duplicating.
 *
 * Usage:
 *   npx medusa exec ./src/scripts/seed-platform-stats-panel.ts
 */
const DASHBOARD_NAME = "Platform Stats"
const PANEL_NAME = "Platform snapshot"

const OPERATION_OPTIONS = {
  currency: "INR",
  window_days: 30,
  sections: {
    // Paid orders — every capture lands an order_transactions row
    // (reference "capture"), so "processed" is a generic count_distinct
    // over that entity. No Medusa-specific aggregate code needed. Entity
    // names are the query.graph names (see list_graph_entities).
    orders: {
      entity: "order_transactions",
      filters: { reference: "capture" },
      aggregates: {
        processed: { fn: "count_distinct", field: "order_id" },
        trailing: {
          fn: "count_distinct",
          field: "order_id",
          range: { date_field: "created_at" },
        },
      },
      echo: { window_days: true },
    },
    // Platform commission — partner_fees lifecycle, currency-matched
    commission: {
      entity: "partner_fees",
      filters: { status: "accrued" },
      currency_key: "currency_code",
      aggregates: {
        accrued: { fn: "sum", field: "fee_amount" },
        trailing: {
          fn: "sum",
          field: "fee_amount",
          range: { date_field: "accrued_at" },
        },
      },
      echo: { currency: true, window_days: true },
    },
    // Artisan subscriptions — MRR monthly-normalized (yearly / 12)
    subscription: {
      entity: "partner_subscriptions",
      filters: { status: "active" },
      currency_key: "plan.currency_code",
      aggregates: {
        paying_artisans: { fn: "count_distinct", field: "partner_id" },
        mrr: {
          fn: "sum",
          field: "plan.price",
          normalize_interval: { interval_field: "plan.interval", yearly_divisor: 12 },
        },
      },
      echo: { currency: true },
    },
    // Average amount captured per paid order over the trailing window. AOV is
    // the captured payment amount (order_transactions with reference "capture"),
    // NOT order.total: the order module computes total/subtotal/etc from
    // shipping-method adjustments, and query.graph cannot fetch those computed
    // money fields ("Shipping method version is required to load adjustments").
    // Captured amount equals order value for full-payment orders, which is the
    // only graph-fetchable per-order money signal.
    aov: {
      entity: "order_transactions",
      filters: { reference: "capture" },
      currency_key: "currency_code",
      aggregates: {
        amount: { fn: "avg", field: "amount", range: { date_field: "created_at" } },
      },
      echo: { currency: true },
    },
    // Annual run-rate — derived from the subscription section's MRR
    arr: {
      derived: { ref: "subscription", aggregate: "mrr", multiply: 12 },
      echo: { currency: true },
    },
  },
}

export default async function seedPlatformStatsPanel({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const stats: any = container.resolve(STATS_MODULE)

  // Find or create the dashboard.
  const existing = await stats.listStatsDashboards({ name: DASHBOARD_NAME }, { take: 1 })
  let dashboard = (existing || [])[0]
  if (!dashboard) {
    ;[dashboard] = await stats.createStatsDashboards([
      {
        name: DASHBOARD_NAME,
        description:
          "Orders, commissions, ARR, AOV and artisan-subscription MRR — all derived from live rows.",
        icon: "chart-no-axes-combined",
        color: "#10b981",
      },
    ])
    logger.info(`Created dashboard ${dashboard.id} (${DASHBOARD_NAME})`)
  } else {
    logger.info(`Reusing dashboard ${dashboard.id} (${DASHBOARD_NAME})`)
  }

  const payload = {
    dashboard_id: dashboard.id,
    name: PANEL_NAME,
    type: "metric" as const,
    x: 0,
    y: 0,
    width: 12,
    height: 3,
    operation_type: "metric_sections",
    operation_options: OPERATION_OPTIONS,
    display: {},
    cache_ttl_seconds: 300,
    // Public opt-in (`metadata.public === true`) — required by the
    // unauthenticated `GET /web/stats/panels/:id/data` gate.
    metadata: { public: true },
  }

  const currentPanels = await stats.listStatsPanels(
    { dashboard_id: dashboard.id, name: PANEL_NAME },
    { take: 1 }
  )
  const found = (currentPanels || [])[0]

  if (found) {
    await stats.updateStatsPanels({ id: found.id, ...payload })
    logger.info(`Updated panel "${PANEL_NAME}" (${found.id})`)
  } else {
    const [created] = await stats.createStatsPanels([payload])
    logger.info(`Created panel "${PANEL_NAME}" (${created.id})`)
  }

  logger.info(
    `Platform stats panel seeded on dashboard ${dashboard.id}. ` +
      `Resolve it via GET /admin/stats/panels/:id/data or POST /admin/stats/panels/preview.`
  )
}
