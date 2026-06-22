import { MedusaContainer } from "@medusajs/framework/types";
import { ANALYTICS_MODULE } from "../modules/analytics";
import AnalyticsService from "../modules/analytics/service";
import {
  computeDailyStatsForWebsite,
  listWebsitesWithActivity,
} from "../modules/analytics/compute-daily-stats";

/**
 * Daily Analytics Aggregation Job
 *
 * Runs every day at 1 AM and rolls up yesterday's events + sessions into
 * analytics_daily_stats. Upserts the row so re-runs always reflect the
 * latest computation for that day (bounce_rate, device splits, etc.).
 */
export default async function aggregateDailyAnalytics(container: MedusaContainer) {
  const logger = container.resolve("logger");
  const analyticsService: AnalyticsService = container.resolve(ANALYTICS_MODULE);

  logger.info("[Analytics Job] Starting daily aggregation...");

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);

  logger.info(`[Analytics Job] Aggregating data for ${yesterday.toISOString().split("T")[0]}`);

  const websiteIds = await listWebsitesWithActivity(analyticsService, yesterday);
  if (websiteIds.length === 0) {
    logger.info("[Analytics Job] No activity to aggregate for yesterday");
    return;
  }

  let aggregated = 0;
  for (const websiteId of websiteIds) {
    const stats = await computeDailyStatsForWebsite(analyticsService, websiteId, yesterday);
    if (!stats) continue;

    const [existing] = await analyticsService.listAnalyticsDailyStats(
      { website_id: websiteId, date: stats.date } as any,
      { take: 1 } as any
    );

    if (existing) {
      await analyticsService.updateAnalyticsDailyStats({ id: existing.id, ...stats } as any);
    } else {
      await analyticsService.createAnalyticsDailyStats(stats as any);
    }

    aggregated++;
    logger.info(
      `[Analytics Job] ✅ Aggregated website ${websiteId} — sessions=${stats.sessions} bounce_rate=${stats.bounce_rate.toFixed(2)}%`
    );
  }

  logger.info(
    `[Analytics Job] ✅ Daily aggregation completed for ${aggregated} website(s)`
  );
}

export const config = {
  name: "aggregate-daily-analytics",
  schedule: "0 1 * * *", // Every day at 1 AM
};
