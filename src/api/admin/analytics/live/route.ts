import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { analyticsConnections } from "../../../../subscribers/analytics-realtime";
import { ANALYTICS_MODULE } from "../../../../modules/analytics";
import AnalyticsService from "../../../../modules/analytics/service";

/**
 * GET /admin/analytics/live
 * 
 * Server-Sent Events (SSE) endpoint for real-time analytics
 * 
 * Query params:
 * - website_id: The website to monitor
 * 
 * Returns a stream of analytics events as they happen
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { website_id } = req.query;

  if (!website_id) {
    return res.status(400).json({ error: "website_id is required" });
  }

  const analyticsService: AnalyticsService = req.scope.resolve(ANALYTICS_MODULE);

  // Set headers for SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  // Add this connection to the pool
  if (!analyticsConnections.has(website_id as string)) {
    analyticsConnections.set(website_id as string, new Set());
  }
  analyticsConnections.get(website_id as string)!.add(res);

  // Send initial connection message with current stats
  try {
    const stats = await getCurrentStats(analyticsService, website_id as string);
    res.write(`data: ${JSON.stringify({ type: 'connected', data: stats })}\n\n`);
  } catch (error) {
    console.error("[Analytics Live] Error getting initial stats:", error);
  }

  // Send heartbeat every 30 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat\n\n`);
    } catch (error) {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Clean up on disconnect
  req.on("close", () => {
    clearInterval(heartbeat);
    const connections = analyticsConnections.get(website_id as string);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        analyticsConnections.delete(website_id as string);
      }
    }
  });
};

/**
 * Get current analytics stats for a website
 */
async function getCurrentStats(
  analyticsService: AnalyticsService,
  websiteId: string
) {
  // Get recent events (last 5 minutes) to determine active visitors
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const [recentEvents] = await analyticsService.listAndCountAnalyticsEvents(
    {
      website_id: websiteId,
      timestamp: { $gte: fiveMinutesAgo },
    },
    {
      select: [
        "id",
        "event_type",
        "event_name",
        "pathname",
        "timestamp",
        "referrer_source",
        "device_type",
        "browser",
        "visitor_id",
        "session_id",
      ],
    }
  );

  // Count unique visitors and sessions from recent events
  const uniqueVisitorIds = new Set(recentEvents.map((e: any) => e.visitor_id));
  const uniqueSessionIds = new Set(recentEvents.map((e: any) => e.session_id));

  // Get the most recent event per visitor to determine their current page
  const visitorCurrentPages = new Map<string, string>();
  
  // Sort events by timestamp descending
  const sortedEvents = [...recentEvents].sort(
    (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Get the latest page for each visitor
  for (const event of sortedEvents) {
    if (!visitorCurrentPages.has(event.visitor_id)) {
      visitorCurrentPages.set(event.visitor_id, event.pathname);
    }
  }

  // Count visitors per page
  const activePages: Record<string, number> = {};
  for (const pathname of visitorCurrentPages.values()) {
    activePages[pathname] = (activePages[pathname] || 0) + 1;
  }

  // Get last 10 events for activity feed
  const latestEvents = sortedEvents.slice(0, 10);

  return {
    currentVisitors: uniqueSessionIds.size,
    uniqueVisitors: uniqueVisitorIds.size,
    recentEvents: latestEvents,
    activePages: Object.entries(activePages)
      .map(([page, count]) => ({ page, count }))
      .sort((a: any, b: any) => b.count - a.count)
      .slice(0, 5),
  };
}
