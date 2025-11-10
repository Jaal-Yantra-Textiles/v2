import { MedusaContainer } from "@medusajs/framework/types";
import { ANALYTICS_MODULE } from "../modules/analytics";
import AnalyticsService from "../modules/analytics/service";

/**
 * Analytics Data Retention Job
 * 
 * Runs every Sunday at 2 AM to archive old analytics data.
 * 
 * This job:
 * 1. Deletes raw analytics events older than 90 days
 * 2. Keeps aggregated daily stats for historical reporting
 * 3. Helps maintain database performance
 * 4. Reduces storage costs
 * 
 * Note: Daily aggregated stats are kept indefinitely for long-term analytics.
 */
export default async function archiveOldAnalytics(container: MedusaContainer) {
  const logger = container.resolve("logger");
  const analyticsService: AnalyticsService = container.resolve(ANALYTICS_MODULE);

  logger.info("[Analytics Archive] Starting data retention job...");

  try {
    // Define retention period (90 days)
    const retentionDays = 90;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    cutoffDate.setHours(0, 0, 0, 0);

    logger.info(
      `[Analytics Archive] Archiving events older than ${cutoffDate.toISOString().split('T')[0]} (${retentionDays} days)`
    );

    // Count events to be archived
    const [eventsToArchive, totalCount] = await analyticsService.listAndCountAnalyticsEvents(
      {
        timestamp: {
          $lt: cutoffDate,
        },
      },
      {
        select: ["id"],
        take: 1, // Just need the count
      }
    );

    if (totalCount === 0) {
      logger.info("[Analytics Archive] No old events to archive");
      return;
    }

    logger.info(`[Analytics Archive] Found ${totalCount} event(s) to archive`);

    // Delete old events in batches to avoid overwhelming the database
    const batchSize = 1000;
    let deletedCount = 0;

    while (deletedCount < totalCount) {
      // Get batch of old events
      const [batchEvents] = await analyticsService.listAndCountAnalyticsEvents(
        {
          timestamp: {
            $lt: cutoffDate,
          },
        },
        {
          select: ["id"],
          take: batchSize,
        }
      );

      if (batchEvents.length === 0) {
        break;
      }

      // Delete batch
      const eventIds = batchEvents.map((e: any) => e.id);
      await analyticsService.deleteAnalyticsEvents(eventIds);

      deletedCount += batchEvents.length;
      logger.info(
        `[Analytics Archive] Deleted batch of ${batchEvents.length} events (${deletedCount}/${totalCount})`
      );

      // Small delay to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info(
      `[Analytics Archive] ✅ Archived ${deletedCount} old event(s) (kept daily aggregated stats)`
    );

    // Also clean up old sessions (older than 90 days)
    const [oldSessions, sessionCount] = await analyticsService.listAndCountAnalyticsSessions(
      {
        started_at: {
          $lt: cutoffDate,
        },
      },
      {
        select: ["id"],
      }
    );

    if (sessionCount > 0) {
      const sessionIds = oldSessions.map((s: any) => s.id);
      await analyticsService.deleteAnalyticsSessions(sessionIds);
      logger.info(`[Analytics Archive] ✅ Archived ${sessionCount} old session(s)`);
    }

    logger.info("[Analytics Archive] ✅ Data retention job completed successfully");
  } catch (error: any) {
    logger.error(`[Analytics Archive] ❌ Error during data archival: ${error.message}`);
    throw error;
  }
}

export const config = {
  name: "archive-old-analytics",
  schedule: "0 2 * * 0", // Every Sunday at 2 AM
};
