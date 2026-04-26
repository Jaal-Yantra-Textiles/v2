import type { SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";

/**
 * Real-time Analytics Event Subscriber
 * 
 * Listens to analytics events and broadcasts them to connected WebSocket clients
 * for real-time analytics dashboards.
 */

// In-memory store for WebSocket connections
// Key: website_id, Value: Set of response objects for SSE
export const analyticsConnections = new Map<string, Set<any>>();

export default async function analyticsRealtimeSubscriber({ event }: any) {
  const { data } = event;
  
  // Broadcast to all connected clients for this website
  const connections = analyticsConnections.get(data.website_id);
  
  if (connections && connections.size > 0) {
    const message = JSON.stringify({
      type: 'new_event',
      data: {
        id: data.id,
        event_type: data.event_type,
        event_name: data.event_name,
        pathname: data.pathname,
        referrer_source: data.referrer_source,
        visitor_id: data.visitor_id,
        session_id: data.session_id,
        timestamp: data.timestamp,
        device_type: data.device_type,
        browser: data.browser,
        os: data.os,
        country: data.country,
      }
    });

    // Send to all connected clients
    connections.forEach((res) => {
      try {
        res.write(`data: ${message}\n\n`);
      } catch (error) {
        // Remove dead connections
        connections.delete(res);
      }
    });
  }
}

export const config: SubscriberConfig = {
  event: "analytics_event.created",
};
