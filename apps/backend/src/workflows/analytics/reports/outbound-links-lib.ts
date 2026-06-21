/**
 * Pure aggregation helpers for the top outbound-links report (#569 S5a).
 *
 * The client (`apps/analytics/src/analytics.js`) emits a `link_out` custom event
 * whenever a visitor clicks an external-host `<a>`, carrying the resolved
 * destination URL under `metadata.href`. These helpers group those events by
 * `metadata.href` so the admin can render a "top outbound links" panel.
 *
 * Like `breakdown-lib.ts` / `session-pages-lib.ts` these are deliberately
 * framework-free so they can be unit-tested in isolation (`TEST_TYPE=unit`);
 * the workflow/route layer fetches the raw `link_out` events (scoped by website
 * + date range) and delegates the grouping here. The result shape mirrors the
 * breakdown envelope but counts events.
 */

/** Minimal shape of a `link_out` analytics event this module needs. */
export type OutboundLinkEventRow = {
  visitor_id?: string | null;
  metadata?: Record<string, any> | null;
};

export type OutboundLinkBucket = {
  /** The outbound destination URL (never null — see NULL_LABEL). */
  value: string;
  /** Number of link_out events to this href. */
  count: number;
  /** Distinct visitor_id count for this href. */
  unique_visitors: number;
  /** count / total_events as an integer percentage (0–100). */
  percentage: number;
};

export type OutboundLinksResult = {
  total_events: number;
  total_unique_visitors: number;
  /** Buckets sorted by count desc, then value asc, sliced to `limit`. */
  results: OutboundLinkBucket[];
};

/** Default bucket cap, mirroring the events breakdown default. */
export const DEFAULT_OUTBOUND_LINKS_LIMIT = 20;
export const MAX_OUTBOUND_LINKS_LIMIT = 100;

/** Label used when an event has no usable href in metadata. */
const NULL_LABEL = "(none)";

/** Pull the canonical href string out of an event's metadata blob. */
export function extractHref(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") {
    return NULL_LABEL;
  }
  const raw = (metadata as Record<string, any>).href;
  if (raw === null || raw === undefined || raw === "") {
    return NULL_LABEL;
  }
  return String(raw);
}

/**
 * Group `events` by their outbound `metadata.href` and compute count /
 * unique_visitors / percentage per bucket. Buckets are sorted by count desc
 * (ties broken by value asc) and capped to `limit` (clamped to
 * [1, MAX_OUTBOUND_LINKS_LIMIT]).
 */
export function computeOutboundLinks(
  events: OutboundLinkEventRow[] | null | undefined,
  limit: number = DEFAULT_OUTBOUND_LINKS_LIMIT
): OutboundLinksResult {
  const rows = Array.isArray(events) ? events : [];
  const cappedLimit = Math.max(
    1,
    Math.min(
      MAX_OUTBOUND_LINKS_LIMIT,
      Math.floor(limit) || DEFAULT_OUTBOUND_LINKS_LIMIT
    )
  );

  const buckets = new Map<string, { count: number; visitors: Set<string> }>();
  const allVisitors = new Set<string>();

  for (const event of rows) {
    const value = extractHref(event?.metadata);
    const bucket = buckets.get(value) || { count: 0, visitors: new Set<string>() };
    bucket.count++;
    if (event?.visitor_id) {
      bucket.visitors.add(event.visitor_id);
      allVisitors.add(event.visitor_id);
    }
    buckets.set(value, bucket);
  }

  const total = rows.length;

  const results: OutboundLinkBucket[] = Array.from(buckets.entries())
    .map(([value, data]) => ({
      value,
      count: data.count,
      unique_visitors: data.visitors.size,
      percentage: total > 0 ? Math.round((data.count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, cappedLimit);

  return {
    total_events: total,
    total_unique_visitors: allVisitors.size,
    results,
  };
}
