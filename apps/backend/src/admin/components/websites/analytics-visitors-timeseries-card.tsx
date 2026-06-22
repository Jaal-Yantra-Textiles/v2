import { useMemo, useState } from "react";
import { Container, Heading, Text, Skeleton, clx } from "@medusajs/ui";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { useAnalyticsTimeseries } from "../../hooks/api/analytics";

type Interval = "hour" | "day";

/**
 * #569 S8 — Visitors timeseries card with an hour/day interval toggle.
 *
 * Replaces the modal's previous client-side (recent_events-derived) visitor
 * chart with the server-side `GET /admin/analytics-events/timeseries` endpoint
 * (via `useAnalyticsTimeseries`, which already accepts an `interval`). A small
 * segmented control switches granularity:
 *   - "day"  → daily buckets across the selected window (`days`).
 *   - "hour" → hourly buckets across the last 24h (days=1), the natural
 *              resolution for an hourly view.
 *
 * Self-contained so the only edit to the central modal file is the import +
 * mount (keeps the #569 UI stack appending cleanly). Medusa-token styled for
 * the chrome; the recharts gradients mirror the modal's existing chart palette.
 */
export function AnalyticsVisitorsTimeseriesCard({
  websiteId,
  days = 14,
}: {
  websiteId: string;
  days?: number;
}) {
  const [interval, setInterval] = useState<Interval>("day");

  // Hourly view is only meaningful over a short window — fix it to the last 24h.
  const windowDays = interval === "hour" ? 1 : days;

  const { data, isLoading } = useAnalyticsTimeseries(
    websiteId,
    windowDays,
    interval
  );

  const points = useMemo(() => {
    const raw: any[] = Array.isArray(data?.data) ? data.data : [];
    return raw.map((d) => ({
      label: formatLabel(d.timestamp, interval),
      visitors: d.unique_visitors ?? 0,
      pageviews: d.pageviews ?? 0,
    }));
  }, [data, interval]);

  const hasData = points.some((p) => p.visitors > 0 || p.pageviews > 0);

  return (
    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
      <div className="p-4 border-b border-ui-border-base flex items-center justify-between gap-x-2">
        <div>
          <Heading level="h3" className="text-sm font-medium">
            Visitors
          </Heading>
          <Text size="xsmall" className="text-ui-fg-subtle">
            {interval === "hour" ? "Last 24 hours" : `Last ${days} days`}
          </Text>
        </div>
        <IntervalToggle value={interval} onChange={setInterval} />
      </div>

      <div className="p-4">
        {isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : !hasData ? (
          <div className="flex h-[220px] items-center justify-center">
            <Text size="small" className="text-ui-fg-subtle">
              No visitor activity in this {interval === "hour" ? "24h" : "window"} yet.
            </Text>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={points}>
              <defs>
                <linearGradient id="ts_colorVisitors" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="ts_colorPageviews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: "6px",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px" }} />
              <Area
                type="monotone"
                dataKey="visitors"
                stroke="#3b82f6"
                fillOpacity={1}
                fill="url(#ts_colorVisitors)"
                name="Visitors"
              />
              <Area
                type="monotone"
                dataKey="pageviews"
                stroke="#8b5cf6"
                fillOpacity={1}
                fill="url(#ts_colorPageviews)"
                name="Pageviews"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Container>
  );
}

function IntervalToggle({
  value,
  onChange,
}: {
  value: Interval;
  onChange: (next: Interval) => void;
}) {
  const options: { key: Interval; label: string }[] = [
    { key: "hour", label: "Hourly" },
    { key: "day", label: "Daily" },
  ];
  return (
    <div className="inline-flex items-center rounded-md bg-ui-bg-component p-0.5">
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange(opt.key)}
            aria-pressed={active}
            className={clx(
              "rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "bg-ui-bg-base text-ui-fg-base shadow-elevation-card-rest"
                : "text-ui-fg-subtle hover:text-ui-fg-base"
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function formatLabel(timestamp: string, interval: Interval): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return String(timestamp);
  if (interval === "hour") {
    return d.toLocaleTimeString("en-US", { hour: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
