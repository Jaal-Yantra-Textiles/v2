/**
 * Pure session-derived overview metrics (#569 S1).
 *
 * OpenPanel-parity overview adds engagement metrics computed from
 * `analytics_session` rows: bounce rate, average session duration,
 * pages per session, and views per visitor.
 *
 * Kept framework-free so it can be unit-tested without a container and
 * reused by the website-analytics overview workflow.
 */

export type SessionMetricRow = {
  visitor_id?: string | null;
  pageviews?: number | null;
  duration_seconds?: number | null;
  is_bounce?: boolean | null;
};

export type SessionMetrics = {
  /** Number of sessions considered in the window. */
  total_sessions: number;
  /** Bounced sessions / total sessions, ratio 0..1 (rounded to 4 dp). */
  bounce_rate: number;
  /** Mean duration_seconds across sessions with duration > 0 (rounded seconds). */
  avg_session_duration: number;
  /** Mean pageviews across all sessions (rounded to 2 dp). */
  pages_per_session: number;
  /** Total session pageviews / unique session visitors (rounded to 2 dp). */
  views_per_visitor: number;
};

const round = (value: number, dp: number): number => {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
};

/**
 * Compute session-based engagement metrics from a list of session rows.
 * Defensive against null/undefined fields and empty input.
 */
export const computeSessionMetrics = (
  sessions: SessionMetricRow[] | null | undefined
): SessionMetrics => {
  const rows = Array.isArray(sessions) ? sessions : [];
  const total = rows.length;

  if (total === 0) {
    return {
      total_sessions: 0,
      bounce_rate: 0,
      avg_session_duration: 0,
      pages_per_session: 0,
      views_per_visitor: 0,
    };
  }

  let bounced = 0;
  let totalPageviews = 0;
  let durationSum = 0;
  let durationCount = 0;
  const visitors = new Set<string>();

  for (const s of rows) {
    if (s?.is_bounce === true) bounced += 1;

    const pv = Number(s?.pageviews);
    totalPageviews += Number.isFinite(pv) && pv > 0 ? pv : 0;

    const dur = Number(s?.duration_seconds);
    if (Number.isFinite(dur) && dur > 0) {
      durationSum += dur;
      durationCount += 1;
    }

    if (s?.visitor_id) visitors.add(String(s.visitor_id));
  }

  const uniqueVisitors = visitors.size;

  return {
    total_sessions: total,
    bounce_rate: round(bounced / total, 4),
    avg_session_duration: durationCount > 0 ? Math.round(durationSum / durationCount) : 0,
    pages_per_session: round(totalPageviews / total, 2),
    views_per_visitor: uniqueVisitors > 0 ? round(totalPageviews / uniqueVisitors, 2) : 0,
  };
};
