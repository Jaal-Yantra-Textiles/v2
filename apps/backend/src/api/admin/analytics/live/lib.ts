/**
 * @file Pure helpers for the live-analytics SSE endpoint (#344 slice 3 — lightweight path).
 * @description
 * The live dashboard's "active visitors" count must stay correct on a
 * horizontally-scaled (multi-instance) deployment. The in-memory SSE push pool
 * (`analyticsConnections`) only broadcasts events processed by the SAME Fargate
 * instance the client is connected to, so a client on instance A never sees
 * visits ingested by instance B and the count drifts.
 *
 * The reversible, no-new-infra fix the volume-sizing analysis endorsed (KV/poll
 * over a Durable Object, given ~249 events/day) is to periodically re-derive the
 * snapshot from the shared DB and re-push it. Each instance computes the SAME
 * authoritative count from Postgres, so the UI self-heals across instances.
 *
 * `computeLiveStats` is the pure aggregation extracted from the route so it is
 * unit-testable in isolation (no DI, no timers, no res stream).
 * @module API/Admin/Analytics
 */

/** Active-visitor window: events newer than this count toward "currently active". */
export const LIVE_WINDOW_MS = 5 * 60 * 1000;

/**
 * How often the SSE stream re-derives the snapshot from the DB and re-pushes it.
 * Override with `ANALYTICS_LIVE_REFRESH_MS` (clamped to a sane floor). Kept well
 * above the 30s heartbeat so the two never thrash; default 15s.
 */
export function resolveLiveRefreshMs(
  raw: string | undefined = process.env.ANALYTICS_LIVE_REFRESH_MS
): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 15000;
  }
  // Never poll the DB faster than every 5s, regardless of misconfiguration.
  return Math.max(5000, Math.floor(parsed));
}

/** Minimal shape of an analytics event row the live snapshot reads. */
export type LiveAnalyticsEvent = {
  id: string;
  event_type?: string | null;
  event_name?: string | null;
  pathname?: string | null;
  timestamp: Date | string;
  referrer_source?: string | null;
  device_type?: string | null;
  browser?: string | null;
  visitor_id?: string | null;
  session_id?: string | null;
};

export type ActivePage = { page: string; count: number };

export type LiveStats = {
  currentVisitors: number;
  uniqueVisitors: number;
  recentEvents: LiveAnalyticsEvent[];
  activePages: ActivePage[];
};

function toMillis(ts: Date | string): number {
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Aggregate a window of recent events into the live snapshot the UI renders.
 *
 * Pure — same input always yields the same output. The caller is responsible for
 * passing only in-window events (the DB query bounds them by {@link LIVE_WINDOW_MS}).
 *
 * - `currentVisitors`  = distinct non-empty `session_id`
 * - `uniqueVisitors`   = distinct non-empty `visitor_id`
 * - `recentEvents`     = newest-first, capped at 10
 * - `activePages`      = visitor's LATEST page → counted → top 5 by count
 */
export function computeLiveStats(events: LiveAnalyticsEvent[]): LiveStats {
  const sorted = [...events].sort(
    (a, b) => toMillis(b.timestamp) - toMillis(a.timestamp)
  );

  const uniqueSessionIds = new Set<string>();
  const uniqueVisitorIds = new Set<string>();
  // Newest-first walk → first time we see a visitor is their current page.
  const visitorCurrentPage = new Map<string, string>();

  for (const e of sorted) {
    if (e.session_id) {
      uniqueSessionIds.add(e.session_id)
    }
    if (e.visitor_id) {
      uniqueVisitorIds.add(e.visitor_id)
    }
    if (e.visitor_id && e.pathname && !visitorCurrentPage.has(e.visitor_id)) {
      visitorCurrentPage.set(e.visitor_id, e.pathname);
    }
  }

  const pageCounts: Record<string, number> = {};
  for (const pathname of visitorCurrentPage.values()) {
    pageCounts[pathname] = (pageCounts[pathname] || 0) + 1;
  }

  const activePages = Object.entries(pageCounts)
    .map(([page, count]) => ({ page, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return {
    currentVisitors: uniqueSessionIds.size,
    uniqueVisitors: uniqueVisitorIds.size,
    recentEvents: sorted.slice(0, 10),
    activePages,
  };
}
