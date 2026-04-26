import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ANALYTICS_MODULE } from "../modules/analytics"
import AnalyticsService from "../modules/analytics/service"
import { computeDailyStatsForWebsite } from "../modules/analytics/lib/compute-daily-stats"

/**
 * Backfills analytics_daily_stats rows that were written with bounce_rate=0
 * (and missing device/duration fields) by recomputing from events + sessions.
 *
 * Flags:
 *   --dry-run          Show what would change; do not write.
 *   --only-zero        Only touch rows whose bounce_rate is 0 (default behaviour).
 *   --all              Recompute every row regardless of current values.
 *   --website-id=<id>  Restrict to a single website.
 *   --from=YYYY-MM-DD  Start date (inclusive). Defaults to earliest stats row.
 *   --to=YYYY-MM-DD    End date (inclusive). Defaults to today.
 */
export default async function backfillBounceRate({ container, args }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const analyticsService: AnalyticsService = container.resolve(ANALYTICS_MODULE)

  const a = (args as any) || {}
  const dryRun = a["dry-run"] !== undefined
  const recomputeAll = a["all"] !== undefined
  const onlyZero = !recomputeAll
  const websiteFilter: string | undefined = a["website-id"]
  const fromStr: string | undefined = a["from"]
  const toStr: string | undefined = a["to"]

  const filters: Record<string, any> = {}
  if (websiteFilter) filters.website_id = websiteFilter
  if (fromStr || toStr) {
    const range: Record<string, any> = {}
    if (fromStr) {
      const d = new Date(fromStr)
      d.setHours(0, 0, 0, 0)
      range.$gte = d
    }
    if (toStr) {
      const d = new Date(toStr)
      d.setHours(23, 59, 59, 999)
      range.$lte = d
    }
    filters.date = range
  }

  const [rows, total] = await analyticsService.listAndCountAnalyticsDailyStats(
    filters as any,
    { take: 10_000, order: { date: "ASC" } } as any
  )

  logger.info(
    `[backfill-bounce-rate] Loaded ${rows.length}/${total} daily-stats rows. dryRun=${dryRun} onlyZero=${onlyZero}`
  )

  let updated = 0
  let skipped = 0
  let noData = 0
  const errors: Array<{ id: string; error: string }> = []

  for (const row of rows as any[]) {
    if (onlyZero && row.bounce_rate !== 0) {
      skipped++
      continue
    }

    try {
      const computed = await computeDailyStatsForWebsite(
        analyticsService,
        row.website_id,
        new Date(row.date)
      )

      if (!computed) {
        noData++
        continue
      }

      const diff = {
        bounce_rate: `${row.bounce_rate} → ${computed.bounce_rate.toFixed(2)}`,
        sessions: `${row.sessions} → ${computed.sessions}`,
        avg_session_duration: `${row.avg_session_duration} → ${computed.avg_session_duration.toFixed(1)}`,
      }

      if (dryRun) {
        logger.info(
          `[backfill-bounce-rate] DRY ${row.website_id} ${new Date(row.date).toISOString().slice(0, 10)} ${JSON.stringify(diff)}`
        )
      } else {
        await analyticsService.updateAnalyticsDailyStats({
          id: row.id,
          bounce_rate: computed.bounce_rate,
          avg_session_duration: computed.avg_session_duration,
          sessions: computed.sessions,
          pageviews: computed.pageviews,
          unique_visitors: computed.unique_visitors,
          desktop_visitors: computed.desktop_visitors,
          mobile_visitors: computed.mobile_visitors,
          tablet_visitors: computed.tablet_visitors,
          top_pages: computed.top_pages,
          top_referrers: computed.top_referrers,
          top_countries: computed.top_countries,
          browser_stats: computed.browser_stats,
          os_stats: computed.os_stats,
        } as any)
        logger.info(
          `[backfill-bounce-rate] ${row.website_id} ${new Date(row.date).toISOString().slice(0, 10)} ${JSON.stringify(diff)}`
        )
      }
      updated++
    } catch (e: any) {
      errors.push({ id: row.id, error: e.message || String(e) })
    }
  }

  logger.info(
    `[backfill-bounce-rate] Done. ${dryRun ? "Would update" : "Updated"}: ${updated} | Skipped: ${skipped} | No source data: ${noData} | Errors: ${errors.length}`
  )
  if (errors.length > 0) {
    for (const e of errors.slice(0, 20)) {
      logger.warn(`  ${e.id}: ${e.error}`)
    }
  }
}
