import { useState } from "react";
import {
  Container,
  Heading,
  Text,
  Badge,
  Button,
  Select,
  Skeleton,
} from "@medusajs/ui";
import { XMark } from "@medusajs/icons";
import {
  useAnalyticsBreakdown,
  BREAKDOWN_DIMENSIONS,
  type BreakdownDimension,
} from "../../hooks/api/analytics";

/**
 * #559 slice 4 — OpenPanel-style breakdown explorer.
 *
 * A self-contained section that mounts the `useAnalyticsBreakdown` hook (#564)
 * over the `/admin/analytics-events/breakdown` endpoint (#562): pick a dimension,
 * click a row to add it as an equality filter, switch dimension to drill down.
 * Ranked proportional bars, Medusa-native tokens, Skeleton loading, empty state.
 *
 * Window (`days`) is driven by the parent modal's existing time filter.
 */

const DIMENSION_LABELS: Record<BreakdownDimension, string> = {
  country: "Country",
  device_type: "Device",
  browser: "Browser",
  os: "OS",
  referrer_source: "Referrer Source",
  referrer: "Referrer URL",
  utm_source: "UTM Source",
  utm_medium: "UTM Medium",
  utm_campaign: "UTM Campaign",
  utm_term: "UTM Term",
  utm_content: "UTM Content",
  pathname: "Path",
  is_404: "404?",
  event_type: "Event Type",
  event_name: "Event Name",
};

const DEFAULT_LIMIT = 20;

export function AnalyticsBreakdownSection({
  websiteId,
  days,
}: {
  websiteId: string;
  days?: number;
}) {
  const [dimension, setDimension] = useState<BreakdownDimension>("pathname");
  const [filters, setFilters] = useState<
    Partial<Record<BreakdownDimension, string>>
  >({});
  const [limit, setLimit] = useState(DEFAULT_LIMIT);

  const { data, isLoading } = useAnalyticsBreakdown({
    website_id: websiteId,
    dimension,
    days,
    limit,
    filters,
  });

  const breakdown = data?.breakdown;
  const results = breakdown?.results ?? [];
  const filterEntries = Object.entries(filters) as [BreakdownDimension, string][];

  const pickDimension = (d: BreakdownDimension) => {
    setDimension(d);
    setLimit(DEFAULT_LIMIT);
  };

  const addFilter = (value: string) => {
    setFilters((prev) => ({ ...prev, [dimension]: value }));
    setLimit(DEFAULT_LIMIT);
  };

  const removeFilter = (key: BreakdownDimension) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  return (
    <Container className="p-0 overflow-hidden rounded-lg border border-ui-border-base bg-ui-bg-base">
      <div className="p-4 border-b border-ui-border-base flex items-center justify-between gap-x-3 flex-wrap">
        <div className="flex items-center gap-x-2">
          <Heading level="h3" className="text-sm font-medium">
            Breakdown
          </Heading>
          {breakdown && (
            <Text size="xsmall" className="text-ui-fg-subtle">
              {breakdown.total_events.toLocaleString()} events ·{" "}
              {breakdown.total_unique_visitors.toLocaleString()} visitors
            </Text>
          )}
        </div>
        <div className="w-[180px]">
          <Select value={dimension} onValueChange={(v) => pickDimension(v as BreakdownDimension)}>
            <Select.Trigger className="h-8" aria-label="Breakdown dimension">
              <Select.Value />
            </Select.Trigger>
            <Select.Content>
              {BREAKDOWN_DIMENSIONS.map((d) => (
                <Select.Item key={d} value={d}>
                  {DIMENSION_LABELS[d]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select>
        </div>
      </div>

      {filterEntries.length > 0 && (
        <div className="px-4 pt-3 flex items-center gap-x-2 gap-y-2 flex-wrap">
          {filterEntries.map(([key, value]) => (
            <button
              key={key}
              type="button"
              onClick={() => removeFilter(key)}
              className="inline-flex items-center gap-x-1 rounded-full border border-ui-border-base bg-ui-bg-subtle px-2 py-0.5 txt-compact-xsmall text-ui-fg-subtle transition-colors hover:bg-ui-bg-subtle-hover"
              title={`Remove ${DIMENSION_LABELS[key]} filter`}
            >
              <span className="text-ui-fg-muted">{DIMENSION_LABELS[key]}:</span>
              <span className="text-ui-fg-base">{value}</span>
              <XMark className="text-ui-fg-muted" />
            </button>
          ))}
        </div>
      )}

      <div className="p-4">
        {isLoading ? (
          <div className="flex flex-col gap-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <Text
            size="small"
            className="text-ui-fg-subtle py-6 text-center block"
          >
            No events for this dimension in the selected window.
          </Text>
        ) : (
          <div className="flex flex-col gap-y-1">
            {results.map((b) => (
              <button
                key={b.value}
                type="button"
                onClick={() => addFilter(b.value)}
                className="group relative flex items-center justify-between overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors hover:bg-ui-bg-subtle-hover"
                title={`Filter by ${DIMENSION_LABELS[dimension]}: ${b.value}`}
              >
                <div
                  className="absolute inset-y-0 left-0 bg-ui-tag-blue-bg"
                  style={{ width: `${Math.max(b.percentage, 1.5)}%` }}
                  aria-hidden="true"
                />
                <Text
                  size="small"
                  className="relative z-10 truncate pr-3 text-ui-fg-base"
                >
                  {b.value}
                </Text>
                <div className="relative z-10 flex shrink-0 items-center gap-x-3">
                  <Text size="xsmall" className="text-ui-fg-subtle tabular-nums">
                    {b.unique_visitors.toLocaleString()} vis
                  </Text>
                  <Text size="small" className="font-medium tabular-nums">
                    {b.count.toLocaleString()}
                  </Text>
                  <Badge size="2xsmall">{b.percentage}%</Badge>
                </div>
              </button>
            ))}
            {results.length >= limit && (
              <Button
                size="small"
                variant="transparent"
                className="mt-2 self-center"
                onClick={() => setLimit((l) => l + DEFAULT_LIMIT)}
              >
                Show more
              </Button>
            )}
          </div>
        )}
      </div>
    </Container>
  );
}
