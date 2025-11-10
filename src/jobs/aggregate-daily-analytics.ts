import { MedusaContainer } from "@medusajs/framework/types";
import { ANALYTICS_MODULE } from "../modules/analytics";
import AnalyticsService from "../modules/analytics/service";

/**
 * Daily Analytics Aggregation Job
 * 
 * Runs every day at 1 AM to aggregate yesterday's analytics data
 * into the analytics_daily_stats table for faster historical queries.
 * 
 * This job:
 * 1. Gets all websites
 * 2. For each website, aggregates yesterday's events
 * 3. Stores aggregated stats in analytics_daily_stats
 * 4. Improves performance for historical analytics queries
 */
export default async function aggregateDailyAnalytics(container: MedusaContainer) {
  const logger = container.resolve("logger");
  const analyticsService: AnalyticsService = container.resolve(ANALYTICS_MODULE);

  logger.info("[Analytics Job] Starting daily aggregation...");

  try {
    // Get yesterday's date range
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    logger.info(`[Analytics Job] Aggregating data for ${yesterday.toISOString().split('T')[0]}`);

    // Get all analytics events from yesterday
    const [events] = await analyticsService.listAndCountAnalyticsEvents(
      {
        timestamp: {
          $gte: yesterday,
          $lt: today,
        },
      },
      {
        select: [
          "website_id",
          "event_type",
          "visitor_id",
          "session_id",
          "pathname",
          "referrer_source",
        ],
      }
    );

    if (events.length === 0) {
      logger.info("[Analytics Job] No events to aggregate for yesterday");
      return;
    }

    // Group events by website_id
    const eventsByWebsite = events.reduce((acc: any, event: any) => {
      if (!acc[event.website_id]) {
        acc[event.website_id] = [];
      }
      acc[event.website_id].push(event);
      return acc;
    }, {});

    // Aggregate stats for each website
    for (const [websiteId, websiteEvents] of Object.entries(eventsByWebsite)) {
      const eventsArray = websiteEvents as any[];
      
      const stats = {
        website_id: websiteId,
        date: yesterday,
        pageviews: eventsArray.filter((e: any) => e.event_type === "pageview").length,
        unique_visitors: new Set(eventsArray.map((e: any) => e.visitor_id)).size,
        sessions: new Set(eventsArray.map((e: any) => e.session_id)).size,
        
        // Store as JSON metadata
        metadata: {
          aggregated_at: new Date(),
          total_events: eventsArray.length,
          total_custom_events: eventsArray.filter((e: any) => e.event_type === "custom_event").length,
          top_pages: getTopItems(eventsArray, "pathname", 10),
          top_referrers: getTopItems(
            eventsArray.filter((e: any) => e.referrer_source),
            "referrer_source",
            10
          ),
        },
      };

      // Create or update daily stats
      try {
        await analyticsService.createAnalyticsDailyStats(stats);
        logger.info(
          `[Analytics Job] ✅ Aggregated ${eventsArray.length} events for website ${websiteId}`
        );
      } catch (error: any) {
        // If stats already exist for this date, update them
        if (error.message?.includes("unique constraint")) {
          logger.info(
            `[Analytics Job] Stats already exist for ${websiteId} on ${yesterday.toISOString().split('T')[0]}, skipping...`
          );
        } else {
          throw error;
        }
      }
    }

    logger.info(
      `[Analytics Job] ✅ Daily aggregation completed for ${Object.keys(eventsByWebsite).length} website(s)`
    );
  } catch (error: any) {
    logger.error(`[Analytics Job] ❌ Error during daily aggregation: ${error.message}`);
    throw error;
  }
}

/**
 * Helper function to get top N items by frequency
 */
function getTopItems(events: any[], field: string, limit: number) {
  const counts = events.reduce((acc: any, event: any) => {
    const value = event[field];
    if (value) {
      acc[value] = (acc[value] || 0) + 1;
    }
    return acc;
  }, {});

  return Object.entries(counts)
    .sort(([, a]: any, [, b]: any) => b - a)
    .slice(0, limit)
    .map(([item, count]) => ({ item, count }));
}

export const config = {
  name: "aggregate-daily-analytics",
  schedule: "0 1 * * *", // Every day at 1 AM
};
