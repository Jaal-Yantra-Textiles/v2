import { MedusaContainer } from "@medusajs/framework/types";
import { ANALYTICS_MODULE } from "../modules/analytics";
import AnalyticsService from "../modules/analytics/service";

/**
 * Analytics Session Cleanup Job
 * 
 * Runs every 10 minutes to:
 * 1. Mark sessions as ended if no activity for 30+ minutes
 * 2. Update session durations
 * 3. Clean up stale session data
 * 
 * This keeps the active session count accurate and ensures
 * session data is properly closed for analytics reporting.
 */
export default async function cleanupAnalyticsSessions(container: MedusaContainer) {
  const logger = container.resolve("logger");
  const analyticsService: AnalyticsService = container.resolve(ANALYTICS_MODULE);

  try {
    // Define session timeout (30 minutes)
    const sessionTimeout = 30 * 60 * 1000; // 30 minutes in milliseconds
    const cutoffTime = new Date(Date.now() - sessionTimeout);

    logger.info(`[Analytics Cleanup] Checking for inactive sessions before ${cutoffTime.toISOString()}`);

    // Get all sessions that haven't been updated in 30+ minutes
    const [staleSessions] = await analyticsService.listAndCountAnalyticsSessions(
      {
        last_activity_at: {
          $lt: cutoffTime,
        },
        ended_at: null, // Only sessions that haven't been marked as ended
      },
      {
        select: ["id", "session_id", "website_id", "started_at", "last_activity_at"],
      }
    );

    if (staleSessions.length === 0) {
      logger.info("[Analytics Cleanup] No stale sessions found");
      return;
    }

    logger.info(`[Analytics Cleanup] Found ${staleSessions.length} stale session(s) to close`);

    // Close each stale session
    for (const session of staleSessions) {
      try {
        // Calculate session duration
        const startTime = new Date(session.started_at).getTime();
        const endTime = new Date(session.last_activity_at).getTime();
        const durationSeconds = Math.floor((endTime - startTime) / 1000);

        // Update session with ended_at and duration
        await analyticsService.updateAnalyticsSessions({
          id: session.id,
          ended_at: session.last_activity_at,
          duration_seconds: durationSeconds,
        });

        logger.info(
          `[Analytics Cleanup] ✅ Closed session ${session.session_id} (duration: ${durationSeconds}s)`
        );
      } catch (error: any) {
        logger.error(
          `[Analytics Cleanup] ❌ Error closing session ${session.session_id}: ${error.message}`
        );
      }
    }

    logger.info(`[Analytics Cleanup] ✅ Closed ${staleSessions.length} inactive session(s)`);
  } catch (error: any) {
    logger.error(`[Analytics Cleanup] ❌ Error during session cleanup: ${error.message}`);
    throw error;
  }
}

export const config = {
  name: "cleanup-analytics-sessions",
  schedule: "*/10 * * * *", // Every 10 minutes
};
