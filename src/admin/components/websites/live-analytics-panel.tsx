import { useEffect, useState, useRef } from "react";
import { useParams } from "react-router-dom";
import { Container, Heading, Text, Badge } from "@medusajs/ui";

interface LiveEvent {
  id: string;
  event_type: string;
  event_name?: string;
  pathname: string;
  timestamp: Date;
  referrer_source?: string;
  device_type?: string;
  browser?: string;
  os?: string;
  country?: string;
}

interface LiveStats {
  currentVisitors: number;
  uniqueVisitors: number;
  recentEvents: LiveEvent[];
  activePages: Array<{ page: string; count: number }>;
}

export const LiveAnalyticsPanel = () => {
  const { id: websiteId } = useParams();
  const [liveData, setLiveData] = useState<LiveStats>({
    currentVisitors: 0,
    uniqueVisitors: 0,
    recentEvents: [],
    activePages: [],
  });
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!websiteId) return;

    // Get API base URL from config and remove trailing slash
    let apiBaseUrl = import.meta.env.VITE_MEDUSA_BACKEND_URL || (import.meta.env.DEV ? "http://localhost:9000" : "");
    apiBaseUrl = apiBaseUrl.replace(/\/$/, ''); // Remove trailing slash

    // Connect to SSE endpoint
    const eventSource = new EventSource(
      `${apiBaseUrl}/admin/analytics/live?website_id=${websiteId}`
    );

    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[Live Analytics] Connected");
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "connected") {
          // Initial stats
          setLiveData(message.data);
        } else if (message.type === "new_event") {
          // New event received - add to feed
          setLiveData((prev) => {
            const newEvents = [message.data, ...prev.recentEvents].slice(0, 20);
            
            // Recalculate unique visitors from recent events
            const uniqueVisitors = new Set(
              newEvents.map(e => e.visitor_id).filter(Boolean)
            );
            
            const uniqueSessions = new Set(
              newEvents.map(e => e.session_id).filter(Boolean)
            );

            // Update active pages - get latest page per visitor
            const visitorPages = new Map<string, string>();
            for (const evt of newEvents) {
              if (evt.visitor_id && evt.pathname && !visitorPages.has(evt.visitor_id)) {
                visitorPages.set(evt.visitor_id, evt.pathname);
              }
            }

            // Count visitors per page
            const pageCounts: Record<string, number> = {};
            for (const pathname of visitorPages.values()) {
              pageCounts[pathname] = (pageCounts[pathname] || 0) + 1;
            }

            const activePages = Object.entries(pageCounts)
              .map(([page, count]) => ({ page, count }))
              .sort((a, b) => b.count - a.count)
              .slice(0, 5);

            return {
              recentEvents: newEvents,
              currentVisitors: uniqueSessions.size,
              uniqueVisitors: uniqueVisitors.size,
              activePages,
            };
          });
        }
      } catch (error) {
        console.error("[Live Analytics] Error parsing message:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[Live Analytics] Connection error:", error);
      setIsConnected(false);
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [websiteId]);

  return (
    <div className="flex flex-col gap-y-6">
      {/* Connection Status */}
      <div className="flex items-center gap-x-2">
        <span
          className={`w-3 h-3 rounded-full ${
            isConnected
              ? "bg-green-500 animate-pulse"
              : "bg-red-500"
          }`}
        />
        <Text size="small" className="text-ui-fg-subtle">
          {isConnected ? "Live" : "Disconnected"}
        </Text>
      </div>

      {/* Current Visitors */}
      <Container className="p-6">
        <div className="flex flex-col gap-y-2">
          <Text size="small" className="text-ui-fg-subtle uppercase tracking-wide">
            Current Visitors
          </Text>
          <div className="flex items-baseline gap-x-4">
            <Text className="text-5xl font-bold">
              {liveData.currentVisitors}
            </Text>
            <Text size="small" className="text-ui-fg-subtle">
              {liveData.uniqueVisitors} unique
            </Text>
          </div>
        </div>
      </Container>

      {/* Active Pages */}
      {liveData.activePages.length > 0 && (
        <Container className="p-0 overflow-hidden">
          <div className="p-4 border-b border-ui-border-base">
            <Heading level="h3" className="text-sm font-medium">
              Active Pages
            </Heading>
          </div>
          <div className="p-4">
            <div className="flex flex-col gap-y-2">
              {liveData.activePages.map((page, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-2 border-b border-ui-border-base last:border-0"
                >
                  <Text size="small" className="font-mono">
                    {page.page}
                  </Text>
                  <Badge size="2xsmall">{page.count} viewing</Badge>
                </div>
              ))}
            </div>
          </div>
        </Container>
      )}

      {/* Live Activity Feed */}
      <Container className="p-0 overflow-hidden">
        <div className="p-4 border-b border-ui-border-base">
          <Heading level="h3" className="text-sm font-medium">
            Live Activity
          </Heading>
        </div>
        <div className="p-4">
          <div className="flex flex-col gap-y-2 max-h-96 overflow-y-auto">
            {liveData.recentEvents.length === 0 ? (
              <Text className="text-ui-fg-subtle text-sm text-center py-8">
                Waiting for activity...
              </Text>
            ) : (
              liveData.recentEvents.map((event, idx) => (
                <LiveEventRow key={`${event.id}-${idx}`} event={event} />
              ))
            )}
          </div>
        </div>
      </Container>
    </div>
  );
};

// Live Event Row Component
function LiveEventRow({ event }: { event: LiveEvent }) {
  const [isNew, setIsNew] = useState(true);

  useEffect(() => {
    // Highlight new events for 2 seconds
    const timer = setTimeout(() => setIsNew(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      className={`flex items-center justify-between py-2 px-3 rounded border-b border-ui-border-base last:border-0 transition-colors ${
        isNew ? "bg-blue-50 dark:bg-blue-900/20" : ""
      }`}
    >
      <div className="flex flex-col gap-y-1 flex-1">
        <div className="flex items-center gap-x-2">
          <Badge
            size="2xsmall"
            color={event.event_type === "pageview" ? "blue" : "purple"}
          >
            {event.event_type}
          </Badge>
          <Text size="small" className="font-medium">
            {event.pathname}
          </Text>
        </div>
        <div className="flex items-center gap-x-3 text-xs text-ui-fg-subtle">
          {event.referrer_source && event.referrer_source !== "direct" && (
            <span>from {event.referrer_source}</span>
          )}
          {event.device_type && <span>{event.device_type}</span>}
          {event.browser && <span>{event.browser}</span>}
          {event.country && <span>{event.country}</span>}
        </div>
      </div>
      <Text size="xsmall" className="text-ui-fg-muted">
        {new Date(event.timestamp).toLocaleTimeString()}
      </Text>
    </div>
  );
}
