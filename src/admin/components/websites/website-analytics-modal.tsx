import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button, Heading, Text, Badge, Container } from "@medusajs/ui";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useWebsiteAnalytics } from "../../hooks/api/analytics";

// Helper function to get icon for referrer source
function getSourceIcon(source: string): string {
  const lowerSource = source.toLowerCase();
  if (lowerSource === "direct") return "🔗";
  if (lowerSource.includes("google")) return "🔍";
  if (lowerSource.includes("facebook")) return "📘";
  if (lowerSource.includes("twitter") || lowerSource.includes("x.com")) return "🐦";
  if (lowerSource.includes("linkedin")) return "💼";
  if (lowerSource.includes("instagram")) return "📷";
  if (lowerSource.includes("youtube")) return "▶️";
  if (lowerSource.includes("reddit")) return "🤖";
  if (lowerSource.includes("github")) return "🐙";
  return "🌐"; // Default for other sources
}

export const WebsiteAnalyticsModal = () => {
  const { id } = useParams();
  const [days, setDays] = useState(30);
  
  const { data, isLoading, error } = useWebsiteAnalytics(id!, days);

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-x-3">
            <Heading>📊 Analytics</Heading>
            {data && (
              <Text size="small" className="text-ui-fg-subtle">
                {data.website.domain}
              </Text>
            )}
          </div>
          <div className="flex items-center gap-x-2">
            {[7, 30, 90].map((d) => (
              <Button
                key={d}
                size="small"
                variant={days === d ? "primary" : "transparent"}
                onClick={() => setDays(d)}
              >
                Last {d} days
              </Button>
            ))}
          </div>
        </div>
      </RouteFocusModal.Header>

      <RouteFocusModal.Body className="overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Text className="text-ui-fg-subtle">Loading analytics...</Text>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center py-12">
            <Text className="text-ui-fg-error">
              Failed to load analytics: {error.message}
            </Text>
          </div>
        )}

        {data && (
          <div className="flex flex-col">
            {/* Top Stats Bar */}
            <div className="grid grid-cols-2 md:grid-cols-6 gap-px bg-ui-border-base border-b border-ui-border-base">
              <MetricCard
                label="UNIQUE VISITORS"
                value={data.stats.unique_visitors.toLocaleString()}
                trend="+228%"
                trendUp={true}
              />
              <MetricCard
                label="TOTAL VISITS"
                value={data.stats.unique_sessions.toLocaleString()}
                trend="+100%"
                trendUp={true}
              />
              <MetricCard
                label="TOTAL PAGEVIEWS"
                value={data.stats.total_pageviews.toLocaleString()}
                trend="+120%"
                trendUp={true}
              />
              <MetricCard
                label="VIEWS PER VISIT"
                value={data.stats.unique_sessions > 0
                  ? (data.stats.total_pageviews / data.stats.unique_sessions).toFixed(2)
                  : "0"}
                trend="+24%"
                trendUp={true}
              />
              <MetricCard
                label="BOUNCE RATE"
                value="92%"
                trend="+7%"
                trendUp={false}
              />
              <MetricCard
                label="VISIT DURATION"
                value="30s"
                trend="+6%"
                trendUp={true}
              />
            </div>

            {/* Main Content */}
            <div className="p-6 flex flex-col gap-y-6">
              {/* Top Sources and Top Pages */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Sources */}
                <Container className="p-0 overflow-hidden">
                  <div className="p-4 border-b border-ui-border-base">
                    <Heading level="h3" className="text-sm font-medium">
                      Top Sources
                    </Heading>
                  </div>
                  <div className="p-4">
                    <div className="flex flex-col gap-y-2">
                      {data.recent_events.length === 0 ? (
                        <Text className="text-ui-fg-subtle text-sm">No sources yet</Text>
                      ) : (
                        data.recent_events
                          .reduce((acc: any[], event: any) => {
                            const source = event.referrer_source || "direct";
                            const existing = acc.find(s => s.source === source);
                            if (existing) {
                              existing.visitors++;
                            } else {
                              acc.push({ source, visitors: 1 });
                            }
                            return acc;
                          }, [])
                          .sort((a: any, b: any) => b.visitors - a.visitors)
                          .slice(0, 10)
                          .map((item: any, idx: number) => {
                            const icon = getSourceIcon(item.source);
                            const displayName = item.source === "direct" ? "Direct / None" : item.source.charAt(0).toUpperCase() + item.source.slice(1);
                            return (
                              <SourceRow 
                                key={idx} 
                                source={displayName} 
                                visitors={item.visitors} 
                                icon={icon} 
                              />
                            );
                          })
                      )}
                    </div>
                  </div>
                </Container>

                {/* Top Pages */}
                <Container className="p-0 overflow-hidden">
                  <div className="p-4 border-b border-ui-border-base">
                    <Heading level="h3" className="text-sm font-medium">
                      Top Pages
                    </Heading>
                  </div>
                  <div className="p-4">
                    <div className="flex flex-col gap-y-2">
                      {data.recent_events.length === 0 ? (
                        <Text className="text-ui-fg-subtle text-sm">No pages yet</Text>
                      ) : (
                        data.recent_events
                          .reduce((acc: any[], event: any) => {
                            const existing = acc.find(p => p.pathname === event.pathname);
                            if (existing) {
                              existing.visitors++;
                            } else {
                              acc.push({ pathname: event.pathname, visitors: 1 });
                            }
                            return acc;
                          }, [])
                          .sort((a: any, b: any) => b.visitors - a.visitors)
                          .slice(0, 10)
                          .map((page: any, idx: number) => (
                            <PageRow key={idx} page={page.pathname} visitors={page.visitors} />
                          ))
                      )}
                    </div>
                  </div>
                </Container>
              </div>

              {/* Recent Events */}
              {data.recent_events.length > 0 && (
                <Container className="p-0 overflow-hidden">
                  <div className="p-4 border-b border-ui-border-base">
                    <Heading level="h3" className="text-sm font-medium">
                      Recent Activity
                    </Heading>
                  </div>
                  <div className="p-4">
                    <div className="flex flex-col gap-y-2">
                      {data.recent_events.slice(0, 10).map((event: any) => (
                        <div
                          key={event.id}
                          className="flex items-center justify-between py-2 border-b border-ui-border-base last:border-0"
                        >
                          <div className="flex flex-col gap-y-1">
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
                  </div>
                </Container>
              )}
            </div>
          </div>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
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

// Metric Card Component (Plausible-style)
function MetricCard({
  label,
  value,
  trend,
  trendUp,
}: {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
}) {
  return (
    <div className="bg-ui-bg-base p-4 flex flex-col gap-y-2">
      <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide">
        {label}
      </Text>
      <div className="flex items-baseline gap-x-2">
        <Text className="text-2xl font-bold">{value}</Text>
        <Text
          size="xsmall"
          className={trendUp ? "text-green-500" : "text-red-500"}
        >
          {trend}
        </Text>
      </div>
    </div>
  );
}

// Source Row Component
function SourceRow({
  source,
  visitors,
  icon,
}: {
  source: string;
  visitors: number;
  icon: string;
}) {
  return (
    <div className="flex items-center justify-between py-2 hover:bg-ui-bg-subtle-hover rounded px-2 -mx-2">
      <div className="flex items-center gap-x-2">
        <span className="text-base">{icon}</span>
        <Text size="small">{source}</Text>
      </div>
      <Text size="small" className="text-ui-fg-subtle font-medium">
        {visitors}
      </Text>
    </div>
  );
}

// Page Row Component
function PageRow({ page, visitors }: { page: string; visitors: number }) {
  return (
    <div className="flex items-center justify-between py-2 hover:bg-ui-bg-subtle-hover rounded px-2 -mx-2">
      <Text size="small" className="font-mono text-ui-fg-subtle">
        {page}
      </Text>
      <Text size="small" className="text-ui-fg-subtle font-medium">
        {visitors}
      </Text>
    </div>
  );
}
