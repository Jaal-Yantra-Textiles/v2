import { useState, useMemo } from "react";
import { useParams } from "react-router-dom";
import { Button, Heading, Text, Badge, Container, Input } from "@medusajs/ui";
import * as Popover from "@radix-ui/react-popover";
import { clx } from "@medusajs/ui";
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
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
  TriangleRightMini,
  Adjustments,
  XMarkMini,
} from "@medusajs/icons";
import { RouteFocusModal } from "../modal/route-focus-modal";
import { useWebsiteAnalytics, AnalyticsFilters } from "../../hooks/api/analytics";
import { AnalyticsCountryMap } from "./analytics-country-map";
import { AnalyticsBreakdownSection } from "./analytics-breakdown-section";
import { AnalyticsTop404Card } from "./analytics-top-404-card";
import { AnalyticsEntryExitPagesCard } from "./analytics-entry-exit-pages-card";
import { AnalyticsOutboundLinksCard } from "./analytics-outbound-links-card";
import { AnalyticsSessionsCard } from "./analytics-sessions-card";
import { AnalyticsVisitorsTimeseriesCard } from "./analytics-visitors-timeseries-card";
import { AnalyticsSearchDiscoveryCard } from "./analytics-search-discovery-card";

function getSourceIcon(source: string) {
  const s = source.toLowerCase();
  if (s === "direct") return Link;
  if (s.includes("google")) return MagnifyingGlass;
  if (s.includes("facebook") || s.includes("reddit")) return ChatBubbleLeftRight;
  if (s.includes("twitter") || s.includes("x.com")) return ChatBubbleLeftRight;
  if (s.includes("linkedin")) return BuildingStorefront;
  if (s.includes("instagram")) return Photo;
  if (s.includes("youtube")) return MediaPlay;
  if (s.includes("github")) return TriangleRightMini;
  return ArrowUpRightOnBox;
}

const DEFAULT_FILTERS: AnalyticsFilters = { days: 30 };

// ── Draft filter state (lives inside popover, only committed on Apply) ─────────

type DraftFilters = {
  preset: 7 | 30 | 90 | null   // null = custom range
  customFrom: string
  customTo: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
  pathname: string
  qrKey: string
  qrValue: string
}

const DEFAULT_DRAFT: DraftFilters = {
  preset: 30,
  customFrom: "",
  customTo: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  pathname: "",
  qrKey: "",
  qrValue: "",
}

function draftToFilters(d: DraftFilters): AnalyticsFilters {
  const f: AnalyticsFilters = {};
  if (d.preset !== null) {
    f.days = d.preset;
  } else if (d.customFrom) {
    f.from = d.customFrom;
    if (d.customTo) f.to = d.customTo;
  } else {
    f.days = 30;
  }
  if (d.utmSource)   f.utm_source   = d.utmSource;
  if (d.utmMedium)   f.utm_medium   = d.utmMedium;
  if (d.utmCampaign) f.utm_campaign = d.utmCampaign;
  if (d.pathname)    f.pathname     = d.pathname;
  if (d.qrKey)       f.qr_key       = d.qrKey;
  if (d.qrValue)     f.qr_value     = d.qrValue;
  return f;
}

// ── Filter popover ────────────────────────────────────────────────────────────

function FiltersPopover({
  draft,
  setDraft,
  onApply,
  onClear,
  activeCount,
}: {
  draft: DraftFilters
  setDraft: React.Dispatch<React.SetStateAction<DraftFilters>>
  onApply: () => void
  onClear: () => void
  activeCount: number
}) {
  const set = <K extends keyof DraftFilters>(k: K, v: DraftFilters[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button size="small" variant={activeCount > 0 ? "primary" : "transparent"}>
          <Adjustments className="mr-1" />
          Filters
          {activeCount > 0 && (
            <span className="ml-1.5 bg-white/20 rounded-full text-[10px] w-4 h-4 inline-flex items-center justify-center font-bold leading-none">
              {activeCount}
            </span>
          )}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={16}
          className={clx(
            "bg-ui-bg-base shadow-elevation-flyout rounded-lg outline-none z-[1000]",
            "w-72 flex flex-col"
          )}
        >
          {/* Date range section */}
          <div className="px-4 pt-4 pb-3 flex flex-col gap-y-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
              Date Range
            </Text>

            {/* Preset buttons */}
            <div className="flex gap-x-1">
              {([7, 30, 90] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => set("preset", d)}
                  className={clx(
                    "flex-1 text-xs py-1.5 rounded border transition-colors",
                    draft.preset === d
                      ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-inverted"
                      : "border-ui-border-base bg-ui-bg-base text-ui-fg-base hover:bg-ui-bg-hover"
                  )}
                >
                  Last {d}d
                </button>
              ))}
              <button
                onClick={() => set("preset", null)}
                className={clx(
                  "flex-1 text-xs py-1.5 rounded border transition-colors",
                  draft.preset === null
                    ? "border-ui-border-interactive bg-ui-bg-interactive text-ui-fg-on-inverted"
                    : "border-ui-border-base bg-ui-bg-base text-ui-fg-base hover:bg-ui-bg-hover"
                )}
              >
                Custom
              </button>
            </div>

            {/* Custom date inputs */}
            {draft.preset === null && (
              <div className="flex flex-col gap-y-2">
                <div className="flex items-center gap-x-2">
                  <Text size="xsmall" className="text-ui-fg-subtle w-7 shrink-0">From</Text>
                  <Input
                    type="date"
                    value={draft.customFrom}
                    onChange={(e) => set("customFrom", e.target.value)}
                    className="text-xs h-7 flex-1"
                  />
                </div>
                <div className="flex items-center gap-x-2">
                  <Text size="xsmall" className="text-ui-fg-subtle w-7 shrink-0">To</Text>
                  <Input
                    type="date"
                    value={draft.customTo}
                    onChange={(e) => set("customTo", e.target.value)}
                    className="text-xs h-7 flex-1"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-ui-border-base" />

          {/* Advanced filters section */}
          <div className="px-4 py-3 flex flex-col gap-y-3">
            <Text size="xsmall" weight="plus" className="text-ui-fg-subtle uppercase tracking-wide">
              Advanced Filters
            </Text>

            <div className="flex flex-col gap-y-2">
              {[
                { label: "UTM Source",   value: draft.utmSource,   key: "utmSource",   placeholder: "e.g. instagram" },
                { label: "UTM Medium",   value: draft.utmMedium,   key: "utmMedium",   placeholder: "e.g. social" },
                { label: "UTM Campaign", value: draft.utmCampaign, key: "utmCampaign", placeholder: "e.g. summer26" },
                { label: "Page / Path",  value: draft.pathname,    key: "pathname",    placeholder: "e.g. /products/shirt" },
              ].map(({ label, value, key, placeholder }) => (
                <div key={key} className="flex items-center gap-x-2">
                  <Text size="xsmall" className="text-ui-fg-subtle w-24 shrink-0">{label}</Text>
                  <Input
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => set(key as keyof DraftFilters, e.target.value)}
                    className="text-xs h-7 flex-1"
                  />
                </div>
              ))}

              {/* QR Param — two side-by-side inputs */}
              <div className="flex items-center gap-x-2">
                <Text size="xsmall" className="text-ui-fg-subtle w-24 shrink-0">QR Param</Text>
                <Input
                  placeholder="key"
                  value={draft.qrKey}
                  onChange={(e) => set("qrKey", e.target.value)}
                  className="font-mono text-xs h-7 flex-1"
                />
                <span className="text-ui-fg-muted text-xs">=</span>
                <Input
                  placeholder="value"
                  value={draft.qrValue}
                  onChange={(e) => set("qrValue", e.target.value)}
                  className="font-mono text-xs h-7 flex-1"
                />
              </div>
            </div>
          </div>

          <div className="h-px bg-ui-border-base" />

          {/* Footer */}
          <div className="px-4 py-3 flex items-center justify-between">
            <Button size="small" variant="transparent" onClick={onClear} className="text-ui-fg-subtle">
              Clear all
            </Button>
            <Popover.Close asChild>
              <Button size="small" variant="primary" onClick={onApply}>
                Apply
              </Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export const WebsiteAnalyticsModal = () => {
  const { id } = useParams();
  const [filters, setFilters] = useState<AnalyticsFilters>(DEFAULT_FILTERS);
  const [draft, setDraft] = useState<DraftFilters>(DEFAULT_DRAFT);

  const { data, isLoading, error } = useWebsiteAnalytics(id!, filters);

  const applyFilters = () => setFilters(draftToFilters(draft));

  const clearAllFilters = () => {
    setDraft(DEFAULT_DRAFT);
    setFilters(DEFAULT_FILTERS);
  };

  // Active chips derived from committed filters
  const activeChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    if (filters.utm_source)   chips.push({ label: `source: ${filters.utm_source}`,   onRemove: () => { setDraft((d) => ({ ...d, utmSource: "" }));   setFilters((f) => { const { utm_source, ...r } = f; return r; }); } });
    if (filters.utm_medium)   chips.push({ label: `medium: ${filters.utm_medium}`,   onRemove: () => { setDraft((d) => ({ ...d, utmMedium: "" }));   setFilters((f) => { const { utm_medium, ...r } = f; return r; }); } });
    if (filters.utm_campaign) chips.push({ label: `campaign: ${filters.utm_campaign}`, onRemove: () => { setDraft((d) => ({ ...d, utmCampaign: "" })); setFilters((f) => { const { utm_campaign, ...r } = f; return r; }); } });
    if (filters.pathname)     chips.push({ label: `path: ${filters.pathname}`,       onRemove: () => { setDraft((d) => ({ ...d, pathname: "" }));     setFilters((f) => { const { pathname, ...r } = f; return r; }); } });
    if (filters.qr_key)       chips.push({ label: `QR: ${filters.qr_key}${filters.qr_value ? `=${filters.qr_value}` : ""}`, onRemove: () => { setDraft((d) => ({ ...d, qrKey: "", qrValue: "" })); setFilters((f) => { const { qr_key, qr_value, ...r } = f; return r; }); } });
    if (filters.from)         chips.push({ label: `${filters.from}${filters.to ? ` → ${filters.to}` : " →"}`, onRemove: clearAllFilters });
    return chips;
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps

  // Count non-date active filters for the badge
  const advancedFilterCount = activeChips.filter((c) => !c.label.match(/^\d{4}-/)).length
    + (filters.from ? 1 : 0);

  // Process chart data
  const { sourcesChartData, countriesData } = useMemo(() => {
    if (!data?.recent_events?.length) return { sourcesChartData: [], countriesData: [] };

    const sourceGroups = data.recent_events.reduce((acc: any, event: any) => {
      const source = event.referrer_source || "direct";
      acc[source] = (acc[source] || 0) + 1;
      return acc;
    }, {});

    const sourcesChartData = Object.entries(sourceGroups)
      .map(([name, value]) => ({ name: name === "direct" ? "Direct" : name, value }))
      .sort((a: any, b: any) => b.value - a.value)
      .slice(0, 5);

    const countryGroups = data.recent_events.reduce((acc: any, event: any) => {
      const country = event.country || "Unknown";
      if (country !== "Unknown") acc[country] = (acc[country] || 0) + 1;
      return acc;
    }, {});

    const countriesData = Object.entries(countryGroups)
      .map(([country, visitors]) => ({ country, visitors: visitors as number }))
      .sort((a: any, b: any) => b.visitors - a.visitors);

    return { sourcesChartData, countriesData };
  }, [data]);

  const COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981'];
  const currentDays = filters.days;

  return (
    <RouteFocusModal>
      <RouteFocusModal.Header>
        <div className="flex flex-col w-full gap-y-2">
          {/* Main header row */}
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
            <div className="flex items-center gap-x-1.5">
              {([7, 30, 90] as const).map((d) => (
                <Button
                  key={d}
                  size="small"
                  variant={!filters.from && currentDays === d ? "primary" : "transparent"}
                  onClick={() => {
                    setDraft((dr) => ({ ...dr, preset: d }));
                    setFilters((f) => {
                      const { from, to, ...rest } = f;
                      return { ...rest, days: d };
                    });
                  }}
                >
                  {d}d
                </Button>
              ))}
              <div className="w-px h-4 bg-ui-border-base mx-0.5" />
              <FiltersPopover
                draft={draft}
                setDraft={setDraft}
                onApply={applyFilters}
                onClear={clearAllFilters}
                activeCount={advancedFilterCount}
              />
            </div>
          </div>

          {/* Active filter chips */}
          {activeChips.length > 0 && (
            <div className="flex flex-wrap gap-x-1.5 gap-y-1 pb-0.5">
              {activeChips.map((chip, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-x-1 pl-2 pr-1 py-0.5 rounded-md bg-ui-tag-neutral-bg border border-ui-tag-neutral-border text-ui-tag-neutral-text text-[11px] font-medium"
                >
                  {chip.label}
                  <button onClick={chip.onRemove} className="hover:opacity-60 flex items-center">
                    <XMarkMini />
                  </button>
                </span>
              ))}
            </div>
          )}
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
            <Text className="text-ui-fg-error">Failed to load analytics: {error.message}</Text>
          </div>
        )}

        {data && (
          <div className="flex flex-col">
            {/* Stats */}
            <div className="p-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <MetricCard label="UNIQUE VISITORS"  value={data.stats.unique_visitors.toLocaleString()}  icon={Users} />
                <MetricCard label="TOTAL VISITS"     value={data.stats.unique_sessions.toLocaleString()}  icon={ArrowPath} />
                <MetricCard label="TOTAL PAGEVIEWS"  value={data.stats.total_pageviews.toLocaleString()}  icon={Eye} />
                <MetricCard
                  label="VIEWS PER VISIT"
                  value={data.stats.unique_sessions > 0
                    ? (data.stats.total_pageviews / data.stats.unique_sessions).toFixed(2)
                    : "0"}
                  icon={ChartBar}
                />
              </div>

              {/* Session-derived engagement metrics (#569 S1b) */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 mt-4">
                <MetricCard
                  label="BOUNCE RATE"
                  value={`${Math.round((data.stats.bounce_rate ?? 0) * 100)}%`}
                  icon={ArrowUpRightOnBox}
                />
                <MetricCard
                  label="AVG. DURATION"
                  value={formatDuration(data.stats.avg_session_duration ?? 0)}
                  icon={ChartBar}
                />
                <MetricCard
                  label="PAGES / SESSION"
                  value={(data.stats.pages_per_session ?? 0).toFixed(2)}
                  icon={Eye}
                />
                <MetricCard
                  label="TOTAL SESSIONS"
                  value={(data.stats.total_sessions ?? data.stats.unique_sessions).toLocaleString()}
                  icon={ArrowPath}
                />
              </div>
            </div>

            <div className="px-6 pb-6 flex flex-col gap-y-6">
              {(
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in fade-in duration-500">
                  <AnalyticsVisitorsTimeseriesCard websiteId={id!} days={currentDays} />

                  {sourcesChartData.length > 0 && (
                    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                      <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                        <Heading level="h3" className="text-sm font-medium">Traffic Sources</Heading>
                        <Text size="xsmall" className="text-ui-fg-subtle">Top 5</Text>
                      </div>
                      <div className="p-4">
                        <RankedBarList
                          items={sourcesChartData.map((s: any) => ({ name: String(s.name), value: Number(s.value) || 0 }))}
                        />
                      </div>
                    </Container>
                  )}
                </div>
              )}

              {id && (
                <AnalyticsSearchDiscoveryCard websiteId={id} days={currentDays} />
              )}

              {countriesData.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 animate-in fade-in duration-700">
                  <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                    <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                      <Heading level="h3" className="text-sm font-medium">🗺️ Visitor Map</Heading>
                      <Text size="xsmall" className="text-ui-fg-subtle">By country</Text>
                    </div>
                    <div className="p-4">
                      <AnalyticsCountryMap countriesData={countriesData} />
                    </div>
                  </Container>

                  <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                    <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                      <Heading level="h3" className="text-sm font-medium">🌍 Top Countries</Heading>
                      <Text size="xsmall" className="text-ui-fg-subtle">Top 10</Text>
                    </div>
                    <div className="p-4">
                      <ResponsiveContainer width="100%" height={320}>
                        <BarChart data={countriesData.slice(0, 10)} layout="vertical">
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                          <YAxis dataKey="country" type="category" width={100} tick={{ fontSize: 12 }} stroke="#9ca3af" />
                          <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '6px', fontSize: '12px' }} />
                          <Bar dataKey="visitors" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                            {countriesData.slice(0, 10).map((_: any, index: number) => (
                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Container>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-in fade-in duration-700">
                <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                  <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                    <Heading level="h3" className="text-sm font-medium">Top Sources</Heading>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {filters.from ? `${filters.from} →` : `Last ${currentDays}d`}
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
                            if (existing) existing.visitors++;
                            else acc.push({ source, visitors: 1 });
                            return acc;
                          }, [])
                          .sort((a: any, b: any) => b.visitors - a.visitors)
                          .slice(0, 10)
                          .map((item: any, idx: number) => {
                            const IconComponent = getSourceIcon(item.source);
                            const displayName = item.source === "direct" ? "Direct / None" : item.source.charAt(0).toUpperCase() + item.source.slice(1);
                            return <SourceRow key={idx} source={displayName} visitors={item.visitors} IconComponent={IconComponent} />;
                          })
                      )}
                    </div>
                  </div>
                </Container>

                <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
                  <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                    <Heading level="h3" className="text-sm font-medium">Top Pages</Heading>
                    <Text size="xsmall" className="text-ui-fg-subtle">
                      {filters.from ? `${filters.from} →` : `Last ${currentDays}d`}
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
                            if (existing) existing.visitors++;
                            else acc.push({ pathname: event.pathname, visitors: 1 });
                            return acc;
                          }, [])
                          .sort((a: any, b: any) => b.visitors - a.visitors)
                          .slice(0, 10)
                          .map((page: any, idx: number) => <PageRow key={idx} page={page.pathname} visitors={page.visitors} />)
                      )}
                    </div>
                  </div>
                </Container>
              </div>

              {data.recent_events.length > 0 && (
                <Container className="p-0 overflow-hidden animate-in fade-in duration-1000 rounded-lg border border-ui-border-base bg-ui-bg-base">
                  <div className="p-4 border-b border-ui-border-base flex items-center justify-between">
                    <Heading level="h3" className="text-sm font-medium">Recent Activity</Heading>
                    <Text size="xsmall" className="text-ui-fg-subtle">Latest 10</Text>
                  </div>
                  <div className="p-4">
                    <div className="flex flex-col gap-y-2">
                      {data.recent_events.slice(0, 10).map((event: any) => (
                        <div key={event.id} className="flex items-center justify-between py-2 border-b border-ui-border-base last:border-0">
                          <div className="flex flex-col gap-y-1">
                            <div className="flex items-center gap-x-2">
                              <Badge size="2xsmall" color={event.event_type === "pageview" ? "blue" : "purple"}>
                                {event.event_type}
                              </Badge>
                              <Text size="small" className="font-medium">{event.pathname}</Text>
                            </div>
                            {event.event_name && (
                              <Text size="xsmall" className="text-ui-fg-subtle">{event.event_name}</Text>
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

              {/* #569 S2b — Entry & Exit pages */}
              {id && (
                <AnalyticsEntryExitPagesCard websiteId={id} days={currentDays} />
              )}

              {/* #569 S5b — Outbound links */}
              {id && (
                <AnalyticsOutboundLinksCard websiteId={id} days={currentDays} />
              )}

              {/* #569 S4 — Top 404s (broken links) */}
              {id && (
                <AnalyticsTop404Card websiteId={id} days={currentDays} />
              )}

              {/* #569 S7b — Sessions DataTable */}
              {id && (
                <AnalyticsSessionsCard websiteId={id} days={currentDays} />
              )}

              {/* #559 slice 4 — OpenPanel-style breakdown explorer */}
              {id && (
                <AnalyticsBreakdownSection websiteId={id} days={currentDays} />
              )}
            </div>
          </div>
        )}
      </RouteFocusModal.Body>

      <RouteFocusModal.Footer>
        <div className="flex items-center justify-end gap-x-2">
          <RouteFocusModal.Close asChild>
            <Button size="small" variant="secondary">Close</Button>
          </RouteFocusModal.Close>
        </div>
      </RouteFocusModal.Footer>
    </RouteFocusModal>
  );
};

/** Format a duration in seconds as "Xm Ys" (or "Ys" under a minute). */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return `${total}s`;
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function MetricCard({ label, value, icon: IconComponent }: { label: string; value: string; icon: React.ComponentType<any> }) {
  return (
    <div className="bg-ui-bg-base p-4 rounded-lg border border-ui-border-base">
      <div className="flex items-start justify-between gap-x-4">
        <div className="flex flex-col gap-y-1">
          <Text size="xsmall" className="text-ui-fg-muted uppercase tracking-wide font-medium">{label}</Text>
          <Text className="text-2xl font-bold">{value}</Text>
        </div>
        <IconComponent className="text-ui-fg-muted" />
      </div>
    </div>
  );
}

function SourceRow({ source, visitors, IconComponent }: { source: string; visitors: number; IconComponent: React.ComponentType<any> }) {
  return (
    <div className="flex items-center justify-between py-2 hover:bg-ui-bg-subtle-hover rounded px-2 -mx-2">
      <div className="flex items-center gap-x-2">
        <IconComponent className="text-ui-fg-subtle" />
        <Text size="small">{source}</Text>
      </div>
      <Text size="small" className="text-ui-fg-subtle font-medium">{visitors}</Text>
    </div>
  );
}

/**
 * OpenPanel-style ranked horizontal bar list. Medusa-token styled (no hardcoded
 * hex) so it follows dark mode. `value` is the raw count; the bar width is scaled
 * to the largest item and the label shows count + share-of-total %.
 */
function RankedBarList({ items }: { items: { name: string; value: number }[] }) {
  const total = items.reduce((sum, it) => sum + (it.value || 0), 0);
  const max = items.reduce((m, it) => Math.max(m, it.value || 0), 0) || 1;
  if (items.length === 0) {
    return <Text size="small" className="text-ui-fg-muted">No data</Text>;
  }
  return (
    <div className="flex flex-col gap-y-3 w-full">
      {items.map((item, index) => {
        const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
        const width = `${Math.max((item.value / max) * 100, 2)}%`;
        return (
          <div key={`${item.name}-${index}`} className="flex flex-col gap-y-1">
            <div className="flex items-center justify-between text-ui-fg-subtle">
              <Text size="small" className="font-medium text-ui-fg-base truncate pr-2">{item.name}</Text>
              <Text size="xsmall" className="tabular-nums whitespace-nowrap">{item.value} · {pct}%</Text>
            </div>
            <div className="h-2 w-full rounded-full bg-ui-bg-component overflow-hidden">
              <div className="h-full rounded-full bg-ui-fg-muted transition-all" style={{ width }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PageRow({ page, visitors }: { page: string; visitors: number }) {
  return (
    <div className="flex items-center justify-between py-2 hover:bg-ui-bg-subtle-hover rounded px-2 -mx-2">
      <Text size="small" className="font-mono text-ui-fg-subtle">{page}</Text>
      <Text size="small" className="text-ui-fg-subtle font-medium">{visitors}</Text>
    </div>
  );
}
