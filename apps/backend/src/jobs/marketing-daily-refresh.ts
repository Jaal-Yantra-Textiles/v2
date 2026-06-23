import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { ANALYTICS_MODULE } from "../modules/analytics"
import { MARKETING_MODULE } from "../modules/marketing"
import {
  computeSnapshotRows,
  istDayStart,
  type MarketingMetricInput,
  type PriorSnapshotRow,
} from "../modules/marketing/compute-snapshot"
import { setHeadlineCache } from "../modules/marketing/cache"

/**
 * marketing-daily-refresh — #659 slice 3, PR-3b.
 *
 * Once a day, recompute the marketing headline metrics from JYT's EXISTING
 * sources (paid orders via Query, the precomputed `analytics_daily_stats`
 * rollup), write append-only `marketing_metric_snapshot` rows to Postgres FIRST,
 * then best-effort warm the Redis hot path. Mirrors `aggregate-daily-analytics.ts`
 * exactly (thin I/O here; the row math lives in the PURE, unit-tested
 * `compute-snapshot.ts` — PR-3a).
 *
 * Cache discipline (spec §4): the snapshot table IS the durable cache; the admin
 * tab (PR-3d) reads it / Redis and NEVER calls an integration on page load.
 *
 * The job computes for the LAST COMPLETE IST business day (yesterday), so a 1 AM
 * UTC run reflects a finished day and aligns with `analytics_daily_stats` (which
 * `aggregate-daily-analytics.ts` rolls up for yesterday). Cron fires in server TZ
 * (UTC in prod) → the IST day is derived explicitly via `istDayStart`, never from
 * local `new Date()` TZ (platform memory: "cron is server-TZ").
 */
export default async function marketingDailyRefresh(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const marketingService: any = container.resolve(MARKETING_MODULE)
  const analyticsService: any = container.resolve(ANALYTICS_MODULE)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // Business day = the last COMPLETE IST calendar day (yesterday in IST).
  const todayIstStart = istDayStart(new Date())
  const dayStart = new Date(todayIstStart.getTime() - 24 * 60 * 60 * 1000)
  const dayEnd = todayIstStart // exclusive upper bound
  const dayLabel = dayStart.toISOString().split("T")[0]

  logger.info(`[Marketing Refresh] Computing snapshot for IST day ${dayLabel}`)

  const inputs: MarketingMetricInput[] = []

  // --- (a) paid-order GMV + order count over the IST day window -----------
  // NOTE: `total` is summed across orders; on a single-currency platform (INR)
  // this is the GMV. Mixed-currency summing is a known v1 limitation — refine
  // with per-currency breakdown when multi-currency GMV is needed.
  try {
    const { data: orders = [] } = await query.graph({
      entity: "order",
      fields: ["id", "total", "currency_code"],
      filters: { created_at: { $gte: dayStart, $lt: dayEnd } },
    })
    const gmv = orders.reduce((sum: number, o: any) => sum + (Number(o.total) || 0), 0)
    const unit = orders[0]?.currency_code?.toUpperCase() ?? null
    inputs.push({ metric_key: "platform_net_gmv", value: gmv, unit })
    inputs.push({ metric_key: "orders_count", value: orders.length, unit: "count" })
    logger.info(`[Marketing Refresh] orders=${orders.length} gmv=${gmv}`)
  } catch (e: any) {
    logger.warn(`[Marketing Refresh] GMV gather failed (skipped): ${e?.message ?? e}`)
  }

  // --- (b) storefront sessions (reuse #559 precomputed rollup; never recompute
  //         from raw events here) + derived conversion rate --------------------
  try {
    const stats = await analyticsService.listAnalyticsDailyStats(
      { date: { $gte: dayStart, $lt: dayEnd } } as any,
      { take: 1000 } as any
    )
    const sessions = (stats ?? []).reduce(
      (sum: number, s: any) => sum + (Number(s.sessions) || 0),
      0
    )
    inputs.push({ metric_key: "storefront_sessions", value: sessions, unit: "count" })

    const ordersInput = inputs.find((i) => i.metric_key === "orders_count")
    if (ordersInput && sessions > 0) {
      const rate = Math.round((ordersInput.value / sessions) * 10000) / 10000
      inputs.push({ metric_key: "storefront_conversion_rate", value: rate, unit: "ratio" })
    }
    logger.info(`[Marketing Refresh] sessions=${sessions}`)
  } catch (e: any) {
    logger.warn(`[Marketing Refresh] sessions gather failed (skipped): ${e?.message ?? e}`)
  }

  // --- (c) partner_activations — DEFERRED. The "partner w/ live storefront +
  //         ≥1 paid order" metric is a multi-hop link query (partner → store →
  //         sales_channel → order) that must be validated with a live
  //         `medusa exec --dry-run` before shipping (memory:
  //         reference_query_graph_filter_shapes). Added in a follow-up once the
  //         join shape is verified; the schema is goal-agnostic so this does not
  //         block the headline (default = platform_net_gmv).

  if (inputs.length === 0) {
    logger.info("[Marketing Refresh] No metrics gathered — nothing to persist")
    return
  }

  const metricKeys = inputs.map((i) => i.metric_key)

  // Prior snapshot rows (strictly before this business day) for day-over-day deltas.
  let priorRows: PriorSnapshotRow[] = []
  try {
    priorRows = await marketingService.listMarketingMetricSnapshots(
      { metric_key: metricKeys, captured_for_date: { $lt: dayStart } } as any,
      { order: { captured_for_date: "DESC" }, take: 200 } as any
    )
  } catch (e: any) {
    logger.warn(`[Marketing Refresh] prior-row read failed (deltas null): ${e?.message ?? e}`)
  }

  const rows = computeSnapshotRows(inputs, dayStart, priorRows, { source: "daily-refresh" })

  // --- PERSIST FIRST (idempotent on the slice-1 unique index
  //     (metric_key, captured_for_date)): update the existing row for this day
  //     or insert a new one. Mirrors aggregate-daily-analytics.ts upsert. -----
  let persisted = 0
  for (const row of rows) {
    try {
      const [existing] = await marketingService.listMarketingMetricSnapshots(
        { metric_key: row.metric_key, captured_for_date: row.captured_for_date } as any,
        { take: 1 } as any
      )
      if (existing) {
        await marketingService.updateMarketingMetricSnapshots({ id: existing.id, ...row } as any)
      } else {
        await marketingService.createMarketingMetricSnapshots(row as any)
      }
      persisted++
    } catch (e: any) {
      logger.warn(
        `[Marketing Refresh] persist failed for ${row.metric_key} (skipped): ${e?.message ?? e}`
      )
    }
  }
  logger.info(`[Marketing Refresh] ✅ Persisted ${persisted}/${rows.length} snapshot rows`)

  // --- THEN warm the cache (best-effort; failures are soft — the snapshot rows
  //     already survived and the read route falls back to Postgres). Never throw
  //     past persist. PR-3c owns the canonical blob shape; this seeds a minimal
  //     headline blob so the hot path is non-empty after a refresh. -----------
  try {
    const headlineKey = "platform_net_gmv" // HEADLINE_METRIC_KEY default (One Goal — spec §1)
    const headline = rows.find((r) => r.metric_key === headlineKey) ?? rows[0] ?? null
    const blob = {
      headline: headline
        ? {
            metric_key: headline.metric_key,
            value: headline.value,
            unit: headline.unit,
            delta_dod: headline.delta_dod,
            captured_for_date: headline.captured_for_date,
          }
        : null,
      strip: rows.map((r) => ({
        metric_key: r.metric_key,
        value: r.value,
        unit: r.unit,
        delta_dod: r.delta_dod,
      })),
      stale: false,
      generated_at: dayEnd.toISOString(),
    }
    const warmed = await setHeadlineCache(blob)
    logger.info(`[Marketing Refresh] cache warm ${warmed ? "ok" : "skipped (no redis)"}`)
  } catch (e: any) {
    logger.warn(`[Marketing Refresh] cache warm failed (soft): ${e?.message ?? e}`)
  }
}

export const config = {
  name: "marketing-daily-refresh",
  schedule: "0 1 * * *", // 1 AM UTC ≈ 6:30 AM IST — matches report §4.3 "6am daily-refresh"
}
