/**
 * Pure aggregation helpers for granular analytics breakdown reports (#559 slice 3).
 *
 * These functions are deliberately framework-free so they can be unit-tested in
 * isolation (`TEST_TYPE=unit`). The workflow/route layer fetches the raw events
 * (scoped by website + date range) and delegates the slicing + filtering here.
 */

/** A single dimension an analytics event can be broken down by. */
export type BreakdownDimension =
  | "country"
  | "device_type"
  | "browser"
  | "os"
  | "referrer_source"
  | "utm_source"
  | "utm_medium"
  | "utm_campaign"
  | "utm_term"
  | "utm_content"
  | "pathname"
  | "is_404"
  | "event_type"
  | "event_name";

/** All dimensions a breakdown report can group by. */
export const BREAKDOWN_DIMENSIONS: BreakdownDimension[] = [
  "country",
  "device_type",
  "browser",
  "os",
  "referrer_source",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "pathname",
  "is_404",
  "event_type",
  "event_name",
];

/**
 * Fields that may be used as composable equality filters. Same set as the
 * dimensions — you can both group by and filter on any of them.
 */
export const FILTERABLE_FIELDS: BreakdownDimension[] = [...BREAKDOWN_DIMENSIONS];

/** Minimal shape of an analytics event row this module needs. */
export type AnalyticsEventRow = {
  visitor_id?: string | null;
  session_id?: string | null;
  country?: string | null;
  device_type?: string | null;
  browser?: string | null;
  os?: string | null;
  referrer_source?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_term?: string | null;
  utm_content?: string | null;
  pathname?: string | null;
  is_404?: boolean | null;
  event_type?: string | null;
  event_name?: string | null;
};

export type BreakdownBucket = {
  /** The normalized dimension value (never null — see NULL_LABELS). */
  value: string;
  /** Number of events in this bucket. */
  count: number;
  /** Distinct visitor_id count in this bucket. */
  unique_visitors: number;
  /** count / total_events as an integer percentage (0–100). */
  percentage: number;
};

export type BreakdownResult = {
  dimension: BreakdownDimension;
  total_events: number;
  total_unique_visitors: number;
  /** Buckets sorted by count desc, then value asc, sliced to `limit`. */
  results: BreakdownBucket[];
};

/** Default bucket cap, mirroring the top-10 cap on the existing stats workflow. */
export const DEFAULT_BREAKDOWN_LIMIT = 20;
export const MAX_BREAKDOWN_LIMIT = 100;

/** Labels used when a dimension value is null/empty, per dimension. */
const NULL_LABELS: Partial<Record<BreakdownDimension, string>> = {
  referrer_source: "direct",
  country: "unknown",
  device_type: "unknown",
  event_type: "unknown",
};

const DEFAULT_NULL_LABEL = "(none)";

export function isBreakdownDimension(value: unknown): value is BreakdownDimension {
  return (
    typeof value === "string" &&
    (BREAKDOWN_DIMENSIONS as string[]).includes(value)
  );
}

export function isFilterableField(value: unknown): value is BreakdownDimension {
  return (
    typeof value === "string" &&
    (FILTERABLE_FIELDS as string[]).includes(value)
  );
}

/** Coerce a raw field value to its canonical string form for grouping/filtering. */
export function normalizeFieldValue(
  field: BreakdownDimension,
  raw: unknown
): string {
  if (field === "is_404") {
    return raw === true || raw === "true" ? "true" : "false";
  }
  if (raw === null || raw === undefined || raw === "") {
    return NULL_LABELS[field] ?? DEFAULT_NULL_LABEL;
  }
  return String(raw);
}

/**
 * Apply composable equality filters. Each filter value is compared against the
 * normalized field value, so e.g. `referrer_source: "direct"` matches null rows.
 * Unknown filter keys are ignored. Returns a new array.
 */
export function applyEventFilters(
  events: AnalyticsEventRow[],
  filters: Partial<Record<string, string>> = {}
): AnalyticsEventRow[] {
  const active = Object.entries(filters).filter(
    ([key, val]) =>
      isFilterableField(key) && val !== undefined && val !== null && val !== ""
  ) as Array<[BreakdownDimension, string]>;

  if (active.length === 0) {
    return [...events];
  }

  return events.filter((event) =>
    active.every(
      ([field, want]) =>
        normalizeFieldValue(field, (event as any)[field]) === want
    )
  );
}

/**
 * Group `events` by `dimension` and compute count / unique_visitors / percentage
 * per bucket. Buckets are sorted by count desc (ties broken by value asc) and
 * capped to `limit` (clamped to [1, MAX_BREAKDOWN_LIMIT]).
 */
export function computeBreakdown(
  events: AnalyticsEventRow[],
  dimension: BreakdownDimension,
  limit: number = DEFAULT_BREAKDOWN_LIMIT
): BreakdownResult {
  const cappedLimit = Math.max(1, Math.min(MAX_BREAKDOWN_LIMIT, Math.floor(limit) || DEFAULT_BREAKDOWN_LIMIT));

  const buckets = new Map<string, { count: number; visitors: Set<string> }>();
  const allVisitors = new Set<string>();

  for (const event of events) {
    const value = normalizeFieldValue(dimension, (event as any)[dimension]);
    const bucket = buckets.get(value) || { count: 0, visitors: new Set<string>() };
    bucket.count++;
    if (event.visitor_id) {
      bucket.visitors.add(event.visitor_id);
      allVisitors.add(event.visitor_id);
    }
    buckets.set(value, bucket);
  }

  const total = events.length;

  const results: BreakdownBucket[] = Array.from(buckets.entries())
    .map(([value, data]) => ({
      value,
      count: data.count,
      unique_visitors: data.visitors.size,
      percentage: total > 0 ? Math.round((data.count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, cappedLimit);

  return {
    dimension,
    total_events: total,
    total_unique_visitors: allVisitors.size,
    results,
  };
}
