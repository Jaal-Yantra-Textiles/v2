import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Button, Heading, Text, Badge, Container } from "@medusajs/ui";
import { RouteFocusModal } from "../modal/route-focus-modal";

interface LiveStats {
  currentVisitors: number;
  uniqueVisitors: number;
  recentEvents: Array<{
    id: string;
    event_type: string;
    pathname: string;
    event_name?: string;
    timestamp: string;
  }>;
  activePages: Array<{ page: string; count: number }>;
}

export const WebsiteLiveAnalyticsModal = () => {
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
          setLiveData((prev) => ({
            ...prev,
            recentEvents: [message.data, ...prev.recentEvents].slice(0, 20),
          }));
        } else if (message.type === "stats_update") {
          // Periodic stats update
          setLiveData(message.data);
        }
      } catch (error) {
        console.error("[Live Analytics] Failed to parse message:", error);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[Live Analytics] Connection error:", error);
      setIsConnected(false);
    };

    // Cleanup on unmount
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        console.log("[Live Analytics] Disconnected");
      }
    };
  }, [websiteId]);

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-x-3">
            <Heading>🔴 Live Analytics</Heading>
            <Badge
              size="small"
              color={isConnected ? "green" : "red"}
            >
              {isConnected ? "Connected" : "Disconnected"}
            </Badge>
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="overflow-y-auto">
        <div className="flex flex-col">
          {/* Top Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-px bg-ui-border-base border-b border-ui-border-base">
            <MetricCard
              label="CURRENT VISITORS"
              value={liveData.currentVisitors.toString()}
              icon="👥"
            />
            <MetricCard
              label="UNIQUE VISITORS"
              value={liveData.uniqueVisitors.toString()}
              icon="🆔"
            />
            <MetricCard
              label="ACTIVE PAGES"
              value={liveData.activePages.length.toString()}
              icon="📄"
            />
          </div>

          {/* Main Content */}
          <div className="p-6 flex flex-col gap-y-6">
            {/* Active Pages */}
            {liveData.activePages.length > 0 && (
              <Container className="p-0 overflow-hidden">
                <div className="p-4 border-b border-ui-border-base">
                  <Heading level="h3" className="text-sm font-medium">
                    Active Pages Right Now
                  </Heading>
                </div>
                <div className="p-4">
                  <div className="flex flex-col gap-y-2">
                    {liveData.activePages.map((page, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-2 hover:bg-ui-bg-subtle-hover rounded px-2 -mx-2"
                      >
                        <Text size="small" className="font-mono text-ui-fg-subtle">
                          {page.page}
                        </Text>
                        <div className="flex items-center gap-x-2">
                          <Badge size="small" color="green">
                            {page.count} {page.count === 1 ? "visitor" : "visitors"}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Container>
            )}

            {/* Recent Events Feed */}
            <Container className="p-0 overflow-hidden">
              <div className="p-4 border-b border-ui-border-base">
                <Heading level="h3" className="text-sm font-medium">
                  Live Activity Feed
                </Heading>
              </div>
              <div className="p-4">
                {liveData.recentEvents.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-y-2">
                    <Text className="text-ui-fg-subtle">
                      Waiting for visitors...
                    </Text>
                    <Text size="small" className="text-ui-fg-muted">
                      Events will appear here in real-time
                    </Text>
                  </div>
                ) : (
                  <div className="flex flex-col gap-y-2">
                    {liveData.recentEvents.map((event) => (
                      <div
                        key={event.id}
                        className="flex items-center justify-between py-2 border-b border-ui-border-base last:border-0 animate-in fade-in slide-in-from-top-2 duration-300"
                      >
                        <div className="flex flex-col gap-y-1">
                          <div className="flex items-center gap-x-2">
                            <Badge
                              size="2xsmall"
                              color={event.event_type === "pageview" ? "blue" : event.event_type === "heartbeat" ? "green" : "purple"}
                            >
                              {event.event_type}
                            </Badge>
                            <Text size="small" className="font-medium">
                              {event.pathname}
                            </Text>
                          </div>
                          {event.event_name && (
                            <Text size="xsmall" className="text-ui-fg-subtle">
                              {event.event_name}
                            </Text>
                          )}
                        </div>
                        <Text size="xsmall" className="text-ui-fg-muted">
                          {new Date(event.timestamp).toLocaleTimeString()}
                        </Text>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Container>

            {/* Connection Status */}
            {!isConnected && (
              <Container className="p-4 bg-ui-bg-subtle">
                <div className="flex items-center gap-x-2">
                  <Text size="small" className="text-ui-fg-subtle">
                    ⚠️ Connection lost. Attempting to reconnect...
                  </Text>
                </div>
              </Container>
            )}
          </div>
        </div>
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-between w-full">
          <Text size="small" className="text-ui-fg-muted">
            Updates every 30 seconds • Real-time tracking
          </Text>
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">
              Close
            </Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
};

// Metric Card Component
function MetricCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="bg-ui-bg-base p-4 flex flex-col gap-y-2">
      <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">
        {label}
      </Text>
      <div className="flex items-baseline gap-x-2">
        <span className="text-2xl">{icon}</span>
        <Text className="text-2xl font-bold">{value}</Text>
      </div>
    </div>
  );
}
