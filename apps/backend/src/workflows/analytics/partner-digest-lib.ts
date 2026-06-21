/**
 * Partner storefront digest — pure compute helpers (#581 S1).
 *
 * Framework-free so they can be unit-tested without a container and reused by
 * the `get-partner-storefront-digest` workflow (and later the visual-flow
 * operation in S3). The heavy lifting (analytics aggregation) is done by the
 * #569 endpoints/libs; this module only:
 *   - resolves a period into a current + previous comparison window,
 *   - turns raw current/previous KPI numbers into delta-annotated metrics,
 *   - maps #559 breakdown results into compact digest items,
 *   - derives rule-based, thresholded "how to boost sales" suggestions.
 *
 * Co-located as `*-lib.ts` next to the workflow on purpose — these are NOT
 * email helpers (do not move into workflows/email/lib; that tree is being
 * dissolved per #578).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A named period or an explicit day count. */
export type DigestPeriod =
  | "last_7_days"
  | "last_28_days"
  | "last_30_days"
  | { days: number };

export type DigestDateRange = {
  /** ISO start (inclusive). */
  start: string;
  /** ISO end (inclusive). */
  end: string;
};

export type DigestPeriodRanges = {
  label: string;
  /** Number of days each window spans. */
  days: number;
  current: DigestDateRange;
  /** Immediately-preceding window of equal length, for WoW-style deltas. */
  previous: DigestDateRange;
};

export type DigestDirection = "up" | "down" | "flat";

export type DigestMetric = {
  current: number;
  previous: number;
  /**
   * Percentage change vs the previous window, rounded to 1 dp.
   * `null` when the previous value is 0 (no meaningful baseline).
   */
  delta_pct: number | null;
  direction: DigestDirection;
};

export type DigestBreakdownItem = {
  value: string;
  count: number;
  /** Share of the window total, integer percentage (0–100). */
  percentage: number;
};

/** Minimal subset of the #569 overview `stats` the digest consumes. */
export type DigestStatsInput = {
  unique_visitors?: number | null;
  total_pageviews?: number | null;
  total_sessions?: number | null;
  bounce_rate?: number | null; // ratio 0..1
  avg_session_duration?: number | null; // seconds
  pages_per_session?: number | null;
};

export type DigestKpis = {
  unique_visitors: DigestMetric;
  pageviews: DigestMetric;
  sessions: DigestMetric;
  bounce_rate: DigestMetric;
  avg_session_duration: DigestMetric;
  pages_per_session: DigestMetric;
};

export type DigestBreakdowns = {
  top_pages: DigestBreakdownItem[];
  referrers: DigestBreakdownItem[];
  devices: DigestBreakdownItem[];
  countries: DigestBreakdownItem[];
};

export type DigestSuggestionSeverity = "info" | "warning" | "opportunity";

export type DigestSuggestion = {
  /** Stable rule id so consumers/templates can key off it. */
  id: string;
  severity: DigestSuggestionSeverity;
  title: string;
  detail: string;
};

export type PartnerStorefrontDigest = {
  partner_id: string;
  website: { id: string; domain: string; name?: string | null } | null;
  period: { label: string; days: number; current: DigestDateRange; previous: DigestDateRange };
  kpis: DigestKpis;
  breakdowns: DigestBreakdowns;
  /** Number of 404 pageviews in the current window. */
  not_found_count: number;
  suggestions: DigestSuggestion[];
};

/** Shape mirrors #559 `BreakdownResult` closely enough for mapping. */
export type DigestBreakdownResultLike = {
  total_events?: number | null;
  results?: Array<{ value?: unknown; count?: unknown; percentage?: unknown }> | null;
};

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export type DigestThresholds = {
  /** Bounce rate (ratio) at/above which we flag the landing page. */
  bounceRateHigh: number;
  /** Mobile traffic share (0..1) at/above which we nudge mobile checkout. */
  mobileShareHigh: number;
  /** Top-referrer share (0..1) at/above which we suggest leaning in. */
  singleReferrerShare: number;
  /** 404 count at/above which we flag broken links. */
  notFoundHigh: number;
  /** Visitor delta_pct at/below which we suggest a promo (negative number). */
  visitorDropPct: number;
  /** pages_per_session at/below which a dominant top page reads as low-engagement. */
  lowEngagementPagesPerSession: number;
  /** Minimum visitors before referrer/page rules fire (avoid noise on tiny samples). */
  minVisitorsForRules: number;
};

export const DEFAULT_DIGEST_THRESHOLDS: DigestThresholds = {
  bounceRateHigh: 0.6,
  mobileShareHigh: 0.6,
  singleReferrerShare: 0.7,
  notFoundHigh: 5,
  visitorDropPct: -10,
  lowEngagementPagesPerSession: 1.5,
  minVisitorsForRules: 20,
};

// ---------------------------------------------------------------------------
// Period resolution
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

const periodDays = (period: DigestPeriod): number => {
  if (typeof period === "object" && period) {
    const d = Math.floor(Number(period.days));
    return Number.isFinite(d) && d > 0 ? d : 7;
  }
  switch (period) {
    case "last_28_days":
      return 28;
    case "last_30_days":
      return 30;
    case "last_7_days":
    default:
      return 7;
  }
};

const periodLabel = (period: DigestPeriod, days: number): string => {
  if (typeof period === "string") return period;
  return `last_${days}_days`;
};

/**
 * Resolve a period into a current window ending at `now` plus an
 * equal-length previous window for comparison. `now` is injectable for
 * deterministic tests; defaults to the wall clock at call time.
 */
export const resolvePeriodRange = (
  period: DigestPeriod,
  now: Date = new Date()
): DigestPeriodRanges => {
  const days = periodDays(period);
  const span = days * DAY_MS;
  const end = now.getTime();
  const currentStart = end - span;
  const previousStart = currentStart - span;

  return {
    label: periodLabel(period, days),
    days,
    current: {
      start: new Date(currentStart).toISOString(),
      end: new Date(end).toISOString(),
    },
    previous: {
      start: new Date(previousStart).toISOString(),
      end: new Date(currentStart).toISOString(),
    },
  };
};

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round = (value: number, dp: number): number => {
  if (!Number.isFinite(value)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
};

/**
 * Build a delta-annotated metric from current/previous raw values.
 * `delta_pct` is null when there is no baseline (previous == 0).
 */
export const computeDigestMetric = (
  current: unknown,
  previous: unknown
): DigestMetric => {
  const cur = num(current);
  const prev = num(previous);

  let delta_pct: number | null = null;
  let direction: DigestDirection = "flat";

  if (prev !== 0) {
    delta_pct = round(((cur - prev) / Math.abs(prev)) * 100, 1);
    if (delta_pct > 0) direction = "up";
    else if (delta_pct < 0) direction = "down";
  } else if (cur > 0) {
    // No baseline but we have current activity — treat as upward, unknown %.
    direction = "up";
  }

  return { current: cur, previous: prev, delta_pct, direction };
};

/** Assemble the KPI block from current + previous overview stats. */
export const buildDigestKpis = (
  current: DigestStatsInput | null | undefined,
  previous: DigestStatsInput | null | undefined
): DigestKpis => {
  const c = current ?? {};
  const p = previous ?? {};
  return {
    unique_visitors: computeDigestMetric(c.unique_visitors, p.unique_visitors),
    pageviews: computeDigestMetric(c.total_pageviews, p.total_pageviews),
    sessions: computeDigestMetric(c.total_sessions, p.total_sessions),
    bounce_rate: computeDigestMetric(c.bounce_rate, p.bounce_rate),
    avg_session_duration: computeDigestMetric(
      c.avg_session_duration,
      p.avg_session_duration
    ),
    pages_per_session: computeDigestMetric(
      c.pages_per_session,
      p.pages_per_session
    ),
  };
};

// ---------------------------------------------------------------------------
// Breakdown mapping
// ---------------------------------------------------------------------------

/** Map a #559 BreakdownResult into compact, top-N digest items. */
export const breakdownToItems = (
  result: DigestBreakdownResultLike | null | undefined,
  limit = 5
): DigestBreakdownItem[] => {
  const rows = Array.isArray(result?.results) ? result!.results! : [];
  const n = Math.max(1, Math.floor(limit) || 5);
  return rows.slice(0, n).map((r) => ({
    value: r?.value === null || r?.value === undefined ? "(none)" : String(r.value),
    count: num(r?.count),
    percentage: num(r?.percentage),
  }));
};

// ---------------------------------------------------------------------------
// Suggestions (rule-based v1)
// ---------------------------------------------------------------------------

const MOBILE_VALUES = new Set(["mobile", "tablet"]);

const mobileShare = (devices: DigestBreakdownItem[]): number => {
  const total = devices.reduce((s, d) => s + d.count, 0);
  if (total <= 0) return 0;
  const mobile = devices
    .filter((d) => MOBILE_VALUES.has(d.value.toLowerCase()))
    .reduce((s, d) => s + d.count, 0);
  return mobile / total;
};

/**
 * Derive thresholded, rule-based suggestions from a digest. Pure and
 * deterministic; ordered most-actionable first. v2 will optionally feed the
 * digest JSON to an `ai-extract` node (S5) for natural-language tips.
 */
export const buildDigestSuggestions = (
  digest: Pick<PartnerStorefrontDigest, "kpis" | "breakdowns" | "not_found_count">,
  thresholds: DigestThresholds = DEFAULT_DIGEST_THRESHOLDS
): DigestSuggestion[] => {
  const t = { ...DEFAULT_DIGEST_THRESHOLDS, ...thresholds };
  const out: DigestSuggestion[] = [];

  const kpis = digest.kpis;
  const bd = digest.breakdowns ?? {
    top_pages: [],
    referrers: [],
    devices: [],
    countries: [],
  };
  const visitors = kpis?.unique_visitors?.current ?? 0;
  const hasSample = visitors >= t.minVisitorsForRules;

  // 1. High / rising bounce rate → landing page + speed.
  const bounce = kpis?.bounce_rate;
  if (
    bounce &&
    (bounce.current >= t.bounceRateHigh ||
      (bounce.direction === "up" && (bounce.delta_pct ?? 0) >= 10))
  ) {
    out.push({
      id: "bounce_rate_high",
      severity: "warning",
      title: "Reduce your bounce rate",
      detail: `Your bounce rate is ${Math.round(
        bounce.current * 100
      )}%. Tighten your landing page copy and improve page load speed so more visitors stay.`,
    });
  }

  // 2. Mobile-heavy traffic → optimise mobile checkout.
  const mShare = mobileShare(bd.devices ?? []);
  if (hasSample && mShare >= t.mobileShareHigh) {
    out.push({
      id: "mobile_heavy_traffic",
      severity: "opportunity",
      title: "Optimize for mobile",
      detail: `${Math.round(
        mShare * 100
      )}% of your traffic is on mobile. Make sure your product pages and checkout are fast and easy on small screens.`,
    });
  }

  // 3. Single dominant referrer → lean into that channel.
  const topReferrer = (bd.referrers ?? [])[0];
  if (
    hasSample &&
    topReferrer &&
    topReferrer.percentage >= t.singleReferrerShare * 100 &&
    topReferrer.value !== "(none)"
  ) {
    out.push({
      id: "single_top_referrer",
      severity: "info",
      title: `Lean into ${topReferrer.value}`,
      detail: `${topReferrer.percentage}% of your visitors come from ${topReferrer.value}. Double down on that channel — and diversify so you're not reliant on one source.`,
    });
  }

  // 4. Dominant top page + low engagement → review pricing/images.
  const topPage = (bd.top_pages ?? [])[0];
  const pps = kpis?.pages_per_session?.current ?? 0;
  if (
    hasSample &&
    topPage &&
    topPage.value !== "(none)" &&
    pps > 0 &&
    pps <= t.lowEngagementPagesPerSession
  ) {
    out.push({
      id: "low_engagement_top_page",
      severity: "opportunity",
      title: "Improve your most-visited page",
      detail: `Most visits land on ${topPage.value} but engagement is low (${pps} pages/session). Review its pricing, images and call-to-action.`,
    });
  }

  // 5. Many 404s → fix broken links / add redirects.
  if ((digest.not_found_count ?? 0) >= t.notFoundHigh) {
    out.push({
      id: "many_404s",
      severity: "warning",
      title: "Fix broken links",
      detail: `Visitors hit ${digest.not_found_count} "page not found" errors. Fix broken links or add redirects so you don't lose them.`,
    });
  }

  // 6. Visitors dropping WoW → run a promo / post on social.
  const uv = kpis?.unique_visitors;
  if (
    uv &&
    uv.direction === "down" &&
    uv.delta_pct !== null &&
    uv.delta_pct <= t.visitorDropPct
  ) {
    out.push({
      id: "visitors_declining",
      severity: "opportunity",
      title: "Win back visitors",
      detail: `Visitors are down ${Math.abs(
        uv.delta_pct
      )}% vs the previous period. Run a promotion or post on social to bring traffic back.`,
    });
  }

  return out;
};
