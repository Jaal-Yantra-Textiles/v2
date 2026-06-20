/**
 * Pure, framework-free helpers for the analytics breakdown hook (#559 slice 4).
 *
 * These types + the `buildBreakdownQuery` query-string builder are intentionally
 * decoupled from React / the Medusa admin SDK so they can be unit-tested without
 * a render harness (the UI render slice itself is Playwright-gated and deferred).
 *
 * The shapes here mirror the server contract of
 * `GET /admin/analytics-events/breakdown` (#559 slice 3, PR #562):
 *   workflows/analytics/reports/breakdown-lib.ts (BreakdownResult/BreakdownBucket)
 *   api/admin/analytics-events/breakdown/route.ts (envelope).
 * Keep them in sync if the server contract changes.
 */

/** Dimensions a breakdown report can group by — mirrors BREAKDOWN_DIMENSIONS. */
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

/** Ordered list of supported dimensions (matches the server's array). */
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

/** Same set as the dimensions — any can be a composable equality filter. */
export const FILTERABLE_FIELDS: BreakdownDimension[] = [...BREAKDOWN_DIMENSIONS];

/** One row of a breakdown — mirrors server BreakdownBucket. */
export interface BreakdownBucket {
  /** Normalized dimension value (never null; null rows get a canonical label). */
  value: string;
  /** Number of events in this bucket. */
  count: number;
  /** Distinct visitor_id count in this bucket. */
  unique_visitors: number;
  /** count / total_events as an integer percentage (0–100). */
  percentage: number;
}

/** The `breakdown` object inside the response — mirrors server BreakdownResult. */
export interface BreakdownResult {
  dimension: BreakdownDimension;
  total_events: number;
  total_unique_visitors: number;
  /** Buckets sorted by count desc (ties by value asc), sliced to `limit`. */
  results: BreakdownBucket[];
}

/** Full response envelope of GET /admin/analytics-events/breakdown. */
export interface AnalyticsBreakdownResponse {
  website_id: string;
  dimension: BreakdownDimension;
  period: {
    start_date?: string;
    end_date?: string;
    days?: number;
  };
  filters: Partial<Record<BreakdownDimension, string>>;
  breakdown: BreakdownResult;
}

/**
 * Input to the breakdown hook / query builder. `website_id` and `dimension`
 * are required by the endpoint; the date window is either a rolling `days` or an
 * explicit `start_date`/`end_date` pair; `limit` caps buckets (server clamps
 * 1–100); `filters` are composable equality filters keyed by any dimension.
 */
export interface BreakdownQueryParams {
  website_id: string;
  dimension: BreakdownDimension;
  /** Rolling window in days. Takes precedence over start/end on the server. */
  days?: number;
  /** Explicit window start (ISO date string). */
  start_date?: string;
  /** Explicit window end (ISO date string). */
  end_date?: string;
  /** Max buckets returned (server default 20, clamped 1–100). */
  limit?: number;
  /** Composable equality filters; empty/blank values are dropped. */
  filters?: Partial<Record<BreakdownDimension, string | number | boolean>>;
}

/**
 * Build the query string for GET /admin/analytics-events/breakdown from typed
 * params. Pure + deterministic: omits undefined/empty values, applies only
 * recognized filterable fields, and never includes both a `days` window and an
 * explicit start/end (days wins, matching the server's precedence) to avoid
 * sending contradictory params.
 *
 * @returns the query string WITHOUT a leading "?".
 */
export function buildBreakdownQuery(params: BreakdownQueryParams): string {
  const sp = new URLSearchParams();

  sp.set("website_id", params.website_id);
  sp.set("dimension", params.dimension);

  // Date window: rolling `days` wins over explicit start/end (server precedence).
  if (params.days != null && Number.isFinite(params.days)) {
    sp.set("days", String(params.days));
  } else {
    if (params.start_date) sp.set("start_date", params.start_date);
    if (params.end_date) sp.set("end_date", params.end_date);
  }

  if (params.limit != null && Number.isFinite(params.limit)) {
    sp.set("limit", String(params.limit));
  }

  // Composable equality filters — only recognized fields, only non-blank values.
  if (params.filters) {
    const allowed = new Set<string>(FILTERABLE_FIELDS);
    for (const [key, raw] of Object.entries(params.filters)) {
      if (!allowed.has(key)) continue;
      if (raw === undefined || raw === null) continue;
      const value = String(raw).trim();
      if (value === "") continue;
      sp.set(key, value);
    }
  }

  return sp.toString();
}

/** Narrowing guard — true if `value` is a supported breakdown dimension. */
export function isBreakdownDimension(
  value: unknown
): value is BreakdownDimension {
  return (
    typeof value === "string" &&
    (BREAKDOWN_DIMENSIONS as string[]).includes(value)
  );
}
