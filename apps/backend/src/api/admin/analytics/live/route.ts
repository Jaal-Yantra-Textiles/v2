/**
 * @file Admin API route for real-time analytics streaming
 * @description Provides a Server-Sent Events (SSE) endpoint for streaming live analytics data for a specific website
 * @module API/Admin/Analytics
 */

/**
 * @typedef {Object} AnalyticsEvent
 * @property {string} id - The unique identifier of the event
 * @property {string} event_type - The type of analytics event (e.g., "page_view")
 * @property {string} event_name - The name of the analytics event
 * @property {string} pathname - The URL path where the event occurred
 * @property {string} timestamp - The timestamp of the event in ISO format
 * @property {string} [referrer_source] - The source of the referrer
 * @property {string} [device_type] - The type of device used
 * @property {string} [browser] - The browser used
 * @property {string} visitor_id - The unique identifier of the visitor
 * @property {string} session_id - The unique identifier of the session
 */

/**
 * @typedef {Object} ActivePage
 * @property {string} page - The URL path of the page
 * @property {number} count - The number of active visitors on the page
 */

/**
 * @typedef {Object} AnalyticsStats
 * @property {number} currentVisitors - The number of active sessions (unique session_id)
 * @property {number} uniqueVisitors - The number of unique visitors (unique visitor_id)
 * @property {AnalyticsEvent[]} recentEvents - The most recent analytics events (up to 10)
 * @property {ActivePage[]} activePages - The top active pages with visitor counts (top 5)
 */

/**
 * @typedef {Object} SSEConnectedEvent
 * @property {string} type - The type of SSE event ("connected")
 * @property {AnalyticsStats} data - The initial analytics statistics
 */

/**
 * @typedef {Object} SSEAnalyticsEvent
 * @property {string} type - The type of SSE event ("event")
 * @property {AnalyticsEvent} data - The analytics event data
 */

/**
 * Stream real-time analytics data for a specific website using Server-Sent Events (SSE)
 * @route GET /admin/analytics/live
 * @group Analytics - Operations related to analytics
 * @param {string} website_id.query.required - The unique identifier of the website to monitor
 * @returns {void} 200 - Opens an SSE stream with periodic updates and heartbeats
 * @throws {MedusaError} 400 - Missing required query parameter `website_id`
 *
 * @example request
 * GET /admin/analytics/live?website_id=web_123456789
 *
 * @example response 200 (SSE Stream)
 * Content-Type: text/event-stream
 *
 * data: {"type":"connected","data":{"currentVisitors":12,"uniqueVisitors":10,"recentEvents":[{"id":"evt_123","event_type":"page_view","event_name":"page_view","pathname":"/","timestamp":"2026-01-14T12:00:00.000Z","visitor_id":"v_1","session_id":"s_1"}],"activePages":[{"page":"/","count":5},{"page":"/pricing","count":3}]}}
 *
 * data: {"type":"event","data":{"id":"evt_456","event_type":"page_view","event_name":"page_view","pathname":"/pricing","timestamp":"2026-01-14T12:05:00.000Z","visitor_id":"v_2","session_id":"s_2"}}
 *
 * : heartbeat
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { analyticsConnections } from "../../../../subscribers/analytics-realtime";
import { ANALYTICS_MODULE } from "../../../../modules/analytics";
import AnalyticsService from "../../../../modules/analytics/service";

/**
 * GET /admin/analytics/live
 *
 * Server-Sent Events (SSE) endpoint that opens a long-lived HTTP connection to stream
 * real-time analytics updates for a specific website.
 *
 * Overview
 * - Accepts a required query parameter `website_id` which identifies the website
 *   whose analytics should be streamed.
 * - Responds as an SSE stream (Content-Type: text/event-stream) and keeps the
 *   connection alive with periodic heartbeats.
 * - On connection, sends an initial "connected" event containing current stats
 *   (active visitors, unique visitors, recent events, top active pages).
 * - Keeps the response object in an in-memory connection pool keyed by website_id
 *   (analyticsConnections) so other parts of the application can push real-time
 *   events to connected clients.
 * - Cleans up the connection and interval timer on client disconnect.
 *
 * Behavior
 * - Required query parameter:
 *   - website_id: string — unique identifier of the website to monitor. If missing,
 *     the endpoint returns HTTP 400 with an error payload.
 *
 * - Response headers set for SSE:
 *   - Content-Type: text/event-stream
 *   - Cache-Control: no-cache
 *   - Connection: keep-alive
 *   - Access-Control-Allow-Origin: *
 *
 * - Initial payload:
 *   - The route attempts to compute current stats by calling an internal helper
 *     (getCurrentStats) which queries recent events (last ~5 minutes) to determine:
 *       * currentVisitors: number of active sessions (unique session_id)
 *       * uniqueVisitors: number of unique visitor IDs seen recently
 *       * recentEvents: array of the most recent events (up to 10)
 *       * activePages: array of top pages with counts (top 5)
 *   - Returns a JSON SSE data event of the form:
 *     data: {"type":"connected","data":{...stats...}}
 *
 * - Heartbeat:
 *   - A heartbeat comment line (`: heartbeat`) is written every 30s to prevent
 *     intermediaries from closing the connection.
 *
 * - Connection management:
 *   - Connections are stored in `analyticsConnections` keyed by website_id.
 *   - When other parts of the system want to broadcast updates, they can iterate
 *     connections for the website_id and `res.write()` SSE messages.
 *   - On request `close`, the route removes the response from the pool and clears
 *     the heartbeat timer. If no connections remain for the website, the key is removed.
 *
 * Error handling and resilience
 * - If getting initial stats fails, the error is logged but the SSE connection
 *   remains open — the client will still receive future pushed events.
 * - If writing to the response fails (e.g. broken pipe), the heartbeat interval is cleared.
 *
 * Example SSE messages (text sent on the open response stream):
 *
 * 1) Initial connected message (single-line data event):
 * data: {"type":"connected","data":{"currentVisitors":12,"uniqueVisitors":10,"recentEvents":[{...}], "activePages":[{"page":"/","count":5},{"page":"/pricing","count":3}]}}
 *
 * 2) Later, when a new analytics event is broadcast from the server (example format):
 * data: {"type":"event","data":{"id":"evt_123","event_type":"page_view","event_name":"page_view","pathname":"/pricing","timestamp":"2026-01-14T12:00:00.000Z","visitor_id":"v_1","session_id":"s_1"}}
 *
 * 3) Heartbeat comment to keep connection alive (clients should ignore):
 * : heartbeat
 *
 * Recommended client usage (browser JS example, for illustration only):
 * const es = new EventSource('/admin/analytics/live?website_id=site_abc');
 * es.onmessage = (e) => {
 *   // e.data contains JSON payload strings; parse and handle by `type` field
 *   const parsed = JSON.parse(e.data);
 *   switch(parsed.type) {
 *     case 'connected': // initial snapshot
 *     case 'event': // incremental update
 *   }
 * };
 * es.onerror = (err) => { /* handle disconnect / retry * / };
 *
 * Notes and considerations
 * - This implementation relies on an in-memory Map (analyticsConnections). In a
 *   multi-process or horizontally scaled deployment you will need a central
 *   pub/sub or websocket gateway (Redis pub/sub, message broker, or a dedicated
 *   realtime service) to broadcast events across instances.
 * - Ensure proper authentication/authorization on the route (not shown here).
 * - Rate-limit and validate `website_id` to avoid unbounded memory growth from
 *   many distinct ids or open connections.
 *
 * @param req - MedusaRequest; expected to contain req.query.website_id and a DI scope to resolve services
 * @param res - MedusaResponse; used as the SSE connection stream and stored in the connection pool
 * @returns void (opens and maintains an SSE stream; final response is not a single JSON payload)
 *
/**
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
