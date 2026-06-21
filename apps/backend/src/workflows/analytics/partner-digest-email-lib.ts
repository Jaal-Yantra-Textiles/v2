/**
 * Partner storefront digest email — pure template-data helpers (#581 S2).
 *
 * Framework-free so the Handlebars template-data assembly + from-address
 * derivation are unit-testable without booting Medusa or a mail provider.
 *
 * Co-located as `*-lib.ts` next to the digest workflow on purpose — NOT placed
 * under `workflows/email/lib/` (that tree is being dissolved per #578). The
 * tiny `derivePartnerFromEmail` helper is re-implemented here (rather than
 * imported from `workflows/email/lib/partner-task-email.ts`) so this slice has
 * no dependency on a directory scheduled for removal.
 */

import type {
  DigestMetric,
  PartnerStorefrontDigest,
} from "./partner-digest-lib";

export interface PartnerDigestEmailInput {
  partner: { name?: string | null; handle?: string | null };
  admin: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  };
  digest: PartnerStorefrontDigest;
  /** Base URL for the "View full analytics" CTA (partner dashboard). */
  dashboardUrl?: string;
  /** Storefront URL surfaced in the footer. */
  storeUrl?: string;
  /** Override for deterministic tests; defaults to the current year. */
  year?: number;
}

/**
 * Partner email from-address: partner+<handle>@<domain>.
 * Mirrors `derivePartnerFromEmail` in the email module so digest, task and
 * order emails all share one sender shape.
 */
export function derivePartnerDigestFromEmail(
  handle: string | null | undefined,
  fromDomain: string
): string {
  const safeHandle = (handle || "partner")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-");
  return `partner+${safeHandle}@${fromDomain}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format an ISO timestamp as e.g. "Jun 14, 2026" (UTC, locale-independent). */
export function formatDigestDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "▲" up / "▼" down / "—" flat. */
export function directionArrow(direction: string): string {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  return "—";
}

/** Human delta label: "+12.3%", "-5%", or "n/a" when there is no baseline. */
export function deltaLabel(metric: DigestMetric | null | undefined): string {
  if (!metric || metric.delta_pct === null || metric.delta_pct === undefined) {
    return "n/a";
  }
  const v = metric.delta_pct;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v}%`;
}

const round = (v: number, dp = 0): number => {
  if (!Number.isFinite(v)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(v * f) / f;
};

/** Seconds → "1m 23s" / "45s". */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

type KpiRow = {
  key: string;
  label: string;
  value: string;
  delta: string;
  direction: string;
  arrow: string;
};

const intRow = (key: string, label: string, m: DigestMetric): KpiRow => ({
  key,
  label,
  value: String(round(m.current)),
  delta: deltaLabel(m),
  direction: m.direction,
  arrow: directionArrow(m.direction),
});

/**
 * Whether the digest window saw ANY real storefront activity.
 *
 * Used to switch the email between the full stats layout and a friendly
 * "start sharing your storefront" nudge (#589 item 2). A partner with a live
 * storefront but zero traffic is intentionally KEPT by the recipient filter
 * (#589 slice 1) — the nudge is what such a partner should see instead of an
 * all-zeros table. Activity is judged on the three headline traffic counts
 * (visitors / pageviews / sessions); the derived KPIs (bounce, duration, etc.)
 * are meaningless without them so they don't widen the test.
 */
export function digestHasData(digest: PartnerStorefrontDigest): boolean {
  const k = digest.kpis;
  return (
    (k.unique_visitors?.current ?? 0) > 0 ||
    (k.pageviews?.current ?? 0) > 0 ||
    (k.sessions?.current ?? 0) > 0
  );
}

/**
 * Build the six KPI rows the email surfaces, pre-formatted for display.
 * Bounce rate renders as a %, avg session duration as m/s, pages/session 1dp.
 */
export function buildKpiRows(digest: PartnerStorefrontDigest): KpiRow[] {
  const k = digest.kpis;
  return [
    intRow("unique_visitors", "Unique visitors", k.unique_visitors),
    intRow("pageviews", "Pageviews", k.pageviews),
    intRow("sessions", "Sessions", k.sessions),
    {
      key: "bounce_rate",
      label: "Bounce rate",
      value: `${round(k.bounce_rate.current * 100)}%`,
      delta: deltaLabel(k.bounce_rate),
      direction: k.bounce_rate.direction,
      arrow: directionArrow(k.bounce_rate.direction),
    },
    {
      key: "avg_session_duration",
      label: "Avg. session",
      value: formatDuration(k.avg_session_duration.current),
      delta: deltaLabel(k.avg_session_duration),
      direction: k.avg_session_duration.direction,
      arrow: directionArrow(k.avg_session_duration.direction),
    },
    {
      key: "pages_per_session",
      label: "Pages / session",
      value: String(round(k.pages_per_session.current, 1)),
      delta: deltaLabel(k.pages_per_session),
      direction: k.pages_per_session.direction,
      arrow: directionArrow(k.pages_per_session.direction),
    },
  ];
}

/**
 * Assemble the Handlebars data for the `partner-storefront-digest` DB template.
 * Scalars are coerced to strings so an undefined/null field renders blank
 * rather than the literal "undefined"; arrays (kpi_rows, breakdowns,
 * suggestions) are passed through for `{{#each}}` blocks.
 */
export function buildPartnerDigestTemplateData(
  input: PartnerDigestEmailInput
): Record<string, any> {
  const { partner, admin, digest } = input;
  const adminName = `${admin.first_name || ""} ${admin.last_name || ""}`.trim();
  const dashboardBase = (input.dashboardUrl || "").replace(/\/$/, "");

  const kpiRows = buildKpiRows(digest);
  const suggestions = digest.suggestions || [];
  const bd = digest.breakdowns || {
    top_pages: [],
    referrers: [],
    devices: [],
    countries: [],
  };

  return {
    // Recipient + partner identity
    partner_name: partner.name || "Partner",
    partner_handle: partner.handle || "",
    admin_name: adminName,
    admin_first_name: admin.first_name || "",

    // Storefront
    website_name: digest.website?.name || digest.website?.domain || "your storefront",
    website_domain: digest.website?.domain || "",
    has_website: Boolean(digest.website),

    // Period
    period_label: digest.period?.label || "",
    period_days: String(digest.period?.days ?? ""),
    period_start: formatDigestDate(digest.period?.current?.start),
    period_end: formatDigestDate(digest.period?.current?.end),

    // Activity state — drives the full-stats vs "start sharing" nudge layout.
    // {{#if has_data}} stats… {{/if}}{{#unless has_data}} nudge… {{/unless}}
    has_data: digestHasData(digest),

    // KPIs (array for {{#each}} + a few headline scalars for the subject)
    kpi_rows: kpiRows,
    visitors_count: String(Math.round(digest.kpis.unique_visitors.current)),
    visitors_delta: deltaLabel(digest.kpis.unique_visitors),

    // Breakdowns
    top_pages: bd.top_pages,
    referrers: bd.referrers,
    devices: bd.devices,
    countries: bd.countries,
    not_found_count: String(digest.not_found_count ?? 0),

    // Suggestions
    suggestions,
    has_suggestions: suggestions.length > 0,
    suggestions_count: String(suggestions.length),

    // Links + footer
    dashboard_url: dashboardBase,
    store_url: input.storeUrl || "",
    current_year: String(input.year ?? new Date().getFullYear()),
  };
}
