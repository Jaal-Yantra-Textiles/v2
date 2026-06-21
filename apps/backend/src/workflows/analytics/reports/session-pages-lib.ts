/**
 * Pure aggregation helpers for session entry/exit page breakdown reports
 * (#569 S2).
 *
 * Like `breakdown-lib.ts` (which aggregates raw analytics *events*), these
 * helpers aggregate analytics *sessions* by their landing (`entry_page`) and
 * leaving (`exit_page`) pages. They are deliberately framework-free so they can
 * be unit-tested in isolation (`TEST_TYPE=unit`); the workflow/route layer
 * fetches the raw sessions (scoped by website + date range) and delegates the
 * grouping here.
 *
 * The result shape mirrors the events breakdown envelope (`BreakdownResult`)
 * but counts sessions rather than events, so the admin UI can render entry/exit
 * page panels with the same ranked-bar component.
 */

/** A page dimension a session can be broken down by. */
export type SessionPageDimension = "entry_page" | "exit_page";

/** All session page dimensions a report can group by. */
export const SESSION_PAGE_DIMENSIONS: SessionPageDimension[] = [
  "entry_page",
  "exit_page",
];

/** Minimal shape of an analytics session row this module needs. */
export type SessionPageRow = {
  visitor_id?: string | null;
  entry_page?: string | null;
  exit_page?: string | null;
};

export type SessionPageBucket = {
  /** The page path (never null — see NULL_LABEL). */
  value: string;
  /** Number of sessions in this bucket. */
  count: number;
  /** Distinct visitor_id count in this bucket. */
  unique_visitors: number;
  /** count / total_sessions as an integer percentage (0–100). */
  percentage: number;
};

export type SessionPageBreakdownResult = {
  dimension: SessionPageDimension;
  total_sessions: number;
  total_unique_visitors: number;
  /** Buckets sorted by count desc, then value asc, sliced to `limit`. */
  results: SessionPageBucket[];
};

/** Default bucket cap, mirroring the events breakdown default. */
export const DEFAULT_SESSION_PAGE_LIMIT = 20;
export const MAX_SESSION_PAGE_LIMIT = 100;

/** Label used when a page value is null/empty (exit_page is nullable). */
const NULL_LABEL = "(none)";

export function isSessionPageDimension(
  value: unknown
): value is SessionPageDimension {
  return (
    typeof value === "string" &&
    (SESSION_PAGE_DIMENSIONS as string[]).includes(value)
  );
}

/** Coerce a raw page value to its canonical string form for grouping. */
export function normalizePageValue(raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") {
    return NULL_LABEL;
  }
  return String(raw);
}

/**
 * Group `sessions` by the chosen page `dimension` and compute count /
 * unique_visitors / percentage per bucket. Buckets are sorted by count desc
 * (ties broken by value asc) and capped to `limit` (clamped to
 * [1, MAX_SESSION_PAGE_LIMIT]).
 */
export function computeSessionPageBreakdown(
  sessions: SessionPageRow[] | null | undefined,
  dimension: SessionPageDimension,
  limit: number = DEFAULT_SESSION_PAGE_LIMIT
): SessionPageBreakdownResult {
  const rows = Array.isArray(sessions) ? sessions : [];
  const cappedLimit = Math.max(
    1,
    Math.min(MAX_SESSION_PAGE_LIMIT, Math.floor(limit) || DEFAULT_SESSION_PAGE_LIMIT)
  );

  const buckets = new Map<string, { count: number; visitors: Set<string> }>();
  const allVisitors = new Set<string>();

  for (const session of rows) {
    const value = normalizePageValue((session as any)[dimension]);
    const bucket = buckets.get(value) || { count: 0, visitors: new Set<string>() };
    bucket.count++;
    if (session.visitor_id) {
      bucket.visitors.add(session.visitor_id);
      allVisitors.add(session.visitor_id);
    }
    buckets.set(value, bucket);
  }

  const total = rows.length;

  const results: SessionPageBucket[] = Array.from(buckets.entries())
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
    total_sessions: total,
    total_unique_visitors: allVisitors.size,
    results,
  };
}
