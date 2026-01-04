import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Button, Heading, Text, Badge, Container } from "@medusajs/ui";
import { AreaChart, Area, PieChart, Pie, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { 
  ChartBar,
  Users,
  Eye,
  ArrowPath,
  ArrowUpRightOnBox,
  Link,
  MagnifyingGlass,
  BuildingStorefront,
  ChatBubbleLeftRight,
  Photo,
  MediaPlay,
  TriangleRightMini
} from "@medusajs/icons";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useWebsiteAnalytics } from "../../hooks/api/analytics";
import { AnalyticsCountryMap } from "./analytics-country-map";

// Helper function to get icon component for referrer source
function getSourceIcon(source: string) {
  const lowerSource = source.toLowerCase();
  if (lowerSource === "direct") return Link;
  if (lowerSource.includes("google")) return MagnifyingGlass;
  if (lowerSource.includes("facebook")) return ChatBubbleLeftRight;
  if (lowerSource.includes("twitter") || lowerSource.includes("x.com")) return ChatBubbleLeftRight;
  if (lowerSource.includes("linkedin")) return BuildingStorefront;
  if (lowerSource.includes("instagram")) return Photo;
  if (lowerSource.includes("youtube")) return MediaPlay;
  if (lowerSource.includes("reddit")) return ChatBubbleLeftRight;
  if (lowerSource.includes("github")) return TriangleRightMini;
  return ArrowUpRightOnBox; // Default for other sources
}

export const WebsiteAnalyticsModal = () => {
  const { id } = useParams();
  const [days, setDays] = useState(30);
  
  const { data, isLoading, error } = useWebsiteAnalytics(id!, days);

  // Process chart data
  const { timeSeriesData, sourcesChartData, countriesData } = useMemo(() => {
    if (!data || !data.recent_events || data.recent_events.length === 0) {
      return { timeSeriesData: [], sourcesChartData: [], countriesData: [] };
    }

    // Group events by date for time series
    const eventsByDate = data.recent_events.reduce((acc: any, event: any) => {
      const date = new Date(event.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (!acc[date]) {
        acc[date] = { date, pageviews: 0, visitors: new Set() };
      }
      acc[date].pageviews++;
      if (event.visitor_id) {
        acc[date].visitors.add(event.visitor_id);
      }
      return acc;
    }, {});

    const timeSeriesData = Object.values(eventsByDate).map((day: any) => ({
      date: day.date,
      pageviews: day.pageviews,
      visitors: day.visitors.size,
    })).slice(-14); // Last 14 days

    // Group by source for pie chart
    const sourceGroups = data.recent_events.reduce((acc: any, event: any) => {
      const source = event.referrer_source || "direct";
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});

    const sourcesChartData = Object.entries(sourceGroups)
      .map(([name, value]) => ({ name: name === "direct" ? "Direct" : name, value }))
      .sort((a: any, b: any) => b.value - a.value)
      .slice(0, 5);

    // Group by country for map
    const countryGroups = data.recent_events.reduce((acc: any, event: any) => {
      const country = event.country || "Unknown";
      if (country !== "Unknown") {
        acc[country] = (acc[country] || 0) + 1;
      }
      return acc;
    }, {});

    const countriesData = Object.entries(countryGroups)
      .map(([country, visitors]) => ({ country, visitors: visitors as number }))
      .sort((a: any, b: any) => b.visitors - a.visitors);

    return { timeSeriesData, sourcesChartData, countriesData };
  }, [data]);

  const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-x-3">
            <ChartBar className="text-ui-fg-subtle" />
            <Heading>Analytics</Heading>
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

      <RouteFocusModal.Body className="overflow-y-auto bg-ui-bg-subtle">
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
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <MetricCard
                  label="UNIQUE VISITORS"
                  value={data.stats.unique_visitors.toLocaleString()}
                  icon={Users}
                />
                <MetricCard
                  label="TOTAL VISITS"
                  value={data.stats.unique_sessions.toLocaleString()}
                  icon={ArrowPath}
                />
                <MetricCard
                  label="TOTAL PAGEVIEWS"
                  value={data.stats.total_pageviews.toLocaleString()}
                  icon={Eye}
                />
                <MetricCard
                  label="VIEWS PER VISIT"
                  value={data.stats.unique_sessions > 0
                    ? (data.stats.total_pageviews / data.stats.unique_sessions).toFixed(2)
                    : "0"}
                  icon={ChartBar}
                />
              </div>
            </div>

            {/* Main Content */}
            <div className="px-6 pb-6 flex flex-col gap-y-6">
              {/* Charts Section */}
              {timeSeriesData.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in fade-in duration-500">
                  {/* Visitors Trend Chart */}
                  <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                    <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                      <Heading level="h3" className="text-sm font-medium">
                        Visitors
                      </Heading>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Last 14 days
                      </Text>
                    </div>
                    <div className="p-4">
                      <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={timeSeriesData}>
                          <defs>
                            <linearGradient id="colorVisitors" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorPageviews" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis 
                            dataKey="date" 
                            tick={{ fontSize: 12 }}
                            stroke="#9ca3af"
                          />
                          <YAxis 
                            tick={{ fontSize: 12 }}
                            stroke="#9ca3af"
                          />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#fff', 
                              border: '1px solid #e5e7eb',
                              borderRadius: '6px',
                              fontSize: '12px'
                            }}
                          />
                          <Legend wrapperStyle={{ fontSize: '12px' }} />
                          <Area 
                            type="monotone" 
                            dataKey="visitors" 
                            stroke="#3b82f6" 
                            fillOpacity={1} 
                            fill="url(#colorVisitors)"
                            name="Visitors"
                          />
                          <Area 
                            type="monotone" 
                            dataKey="pageviews" 
                            stroke="#8b5cf6" 
                            fillOpacity={1} 
                            fill="url(#colorPageviews)"
                            name="Pageviews"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </Container>

                  {/* Traffic Sources Pie Chart */}
                  {sourcesChartData.length > 0 && (
                    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                      <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                        <Heading level="h3" className="text-sm font-medium">
                          Traffic Sources
                        </Heading>
                        <Text size="xsmall" className="text-ui-fg-subtle">
                          Top 5
                        </Text>
                      </div>
                      <div className="p-4 flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={220}>
                          <PieChart>
                            <Pie
                              data={sourcesChartData}
                              cx="50%"
                              cy="50%"
                              labelLine={false}
                              label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                              outerRadius={80}
                              fill="#8884d8"
                              dataKey="value"
                            >
                              {sourcesChartData.map((_entry: any, index: number) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                              ))}
                            </Pie>
                            <Tooltip 
                              contentStyle={{ 
                                backgroundColor: '#fff', 
                                border: '1px solid #e5e7eb',
                                borderRadius: '6px',
                                fontSize: '12px'
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </Container>
                  )}
                </div>
              )}

              {/* Geographic Distribution */}
              {countriesData.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in fade-in duration-700">
                  {/* World Map */}
                  <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                    <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                      <Heading level="h3" className="text-sm font-medium">
                        🗺️ Visitor Map
                      </Heading>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        By country
                      </Text>
                    </div>
                    <div className="p-4">
                      <AnalyticsCountryMap countriesData={countriesData} />
                    </div>
                  </Container>

                  {/* Top Countries Bar Chart */}
                  <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                    <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                      <Heading level="h3" className="text-sm font-medium">
                        🌍 Top Countries
                      </Heading>
                      <Text size="xsmall" className="text-ui-fg-subtle">
                        Top 10
                      </Text>
                    </div>
                    <div className="p-4">
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={countriesData.slice(0, 10)} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                          <YAxis 
                            dataKey="country" 
                            type="category" 
                            width={100}
                            tick={{ fontSize: 12 }}
                            stroke="#9ca3af"
                          />
                          <Tooltip 
                            contentStyle={{ 
                              backgroundColor: '#fff', 
                              border: '1px solid #e5e7eb',
                              borderRadius: '6px',
                              fontSize: '12px'
                            }}
                          />
                          <Bar dataKey="visitors" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                            {countriesData.slice(0, 10).map((_entry: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Container>
                </div>
              )}

              {/* Top Sources and Top Pages */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-700">
                {/* Top Sources */}
                <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                  <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                    <Heading level="h3" className="text-sm font-medium">
                      Top Sources
                    </Heading>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Last {days} days
                    </Text>
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
                            const IconComponent = getSourceIcon(item.source);
                            const displayName = item.source === "direct" ? "Direct / None" : item.source.charAt(0).toUpperCase() + item.source.slice(1);
                            return (
                              <SourceRow 
                                key={idx} 
                                source={displayName} 
                                visitors={item.visitors} 
                                IconComponent={IconComponent} 
                              />
                            );
                          })
                      )}
                    </div>
                  </div>
                </Container>

                {/* Top Pages */}
                <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                  <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                    <Heading level="h3" className="text-sm font-medium">
                      Top Pages
                    </Heading>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Last {days} days
                    </Text>
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
                <Container className="p-0 overflow-hidden animate-in fade-in duration-1000 rounded-lg border border-ui-border-base bg-ui-bg-base">
                  <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                    <Heading level="h3" className="text-sm font-medium">
                      Recent Activity
                    </Heading>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      Latest 10
                    </Text>
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

// Metric Card Component
function MetricCard({
  label,
  value,
  icon: IconComponent,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<any>;
}) {
  return (
    <div className="bg-ui-bg-base p-4 rounded-lg border border-ui-border-base">
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide font-medium">
            {label}
          </Text>
          <Text className="text-2xl font-bold">{value}</Text>
        </div>
        <IconComponent className="text-ui-fg-muted" />
      </div>
    </div>
  );
}

// Source Row Component
function SourceRow({
  source,
  visitors,
  IconComponent,
}: {
  source: string;
  visitors: number;
  IconComponent: React.ComponentType<any>;
}) {
  return (
    <div className="flex items-center justify-between py-2 hover:bg-ui-bg-subtle-hover rounded px-2 -mx-2">
      <div className="flex items-center gap-x-2">
        <IconComponent className="text-ui-fg-subtle" />
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
