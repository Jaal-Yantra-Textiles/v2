import {
  AI_SUMMARY_MAX_LEN,
  buildKpiRows,
  buildPartnerDigestTemplateData,
  deltaLabel,
  derivePartnerDigestFromEmail,
  digestHasData,
  directionArrow,
  formatDigestDate,
  formatDuration,
  sanitizeAiSummary,
} from "../partner-digest-email-lib";
import {
  buildDigestKpis,
  type PartnerStorefrontDigest,
} from "../partner-digest-lib";

const ZERO_STATS = {
  unique_visitors: 0,
  total_pageviews: 0,
  total_sessions: 0,
  bounce_rate: 0,
  avg_session_duration: 0,
  pages_per_session: 0,
};

const makeDigest = (
  over: Partial<PartnerStorefrontDigest> = {}
): PartnerStorefrontDigest => ({
  partner_id: "part_1",
  website: { id: "web_1", domain: "shop.example.com", name: "Example Shop" },
  period: {
    label: "last_7_days",
    days: 7,
    current: {
      start: "2026-06-14T00:00:00.000Z",
      end: "2026-06-21T00:00:00.000Z",
    },
    previous: {
      start: "2026-06-07T00:00:00.000Z",
      end: "2026-06-14T00:00:00.000Z",
    },
  },
  kpis: buildDigestKpis(
    {
      unique_visitors: 150,
      total_pageviews: 600,
      total_sessions: 180,
      bounce_rate: 0.42,
      avg_session_duration: 95,
      pages_per_session: 3.3,
    },
    {
      unique_visitors: 120,
      total_pageviews: 500,
      total_sessions: 150,
      bounce_rate: 0.5,
      avg_session_duration: 80,
      pages_per_session: 3,
    }
  ),
  breakdowns: {
    top_pages: [{ value: "/", count: 200, percentage: 40 }],
    referrers: [{ value: "google", count: 100, percentage: 55 }],
    devices: [{ value: "mobile", count: 120, percentage: 66 }],
    countries: [{ value: "IN", count: 130, percentage: 72 }],
  },
  not_found_count: 3,
  suggestions: [
    {
      id: "mobile_heavy_traffic",
      severity: "opportunity",
      title: "Optimize for mobile",
      detail: "66% of traffic is on mobile.",
    },
  ],
  ...over,
});

describe("derivePartnerDigestFromEmail", () => {
  it("builds partner+<handle>@domain and slugifies the handle", () => {
    expect(derivePartnerDigestFromEmail("Acme Co", "partner.jaalyantra.com")).toBe(
      "partner+acme-co@partner.jaalyantra.com"
    );
  });
  it("falls back to 'partner' for a missing handle", () => {
    expect(derivePartnerDigestFromEmail(null, "x.com")).toBe("partner+partner@x.com");
  });
});

describe("formatDigestDate", () => {
  it("formats an ISO timestamp in UTC as 'Mon D, YYYY'", () => {
    expect(formatDigestDate("2026-06-14T00:00:00.000Z")).toBe("Jun 14, 2026");
  });
  it("returns empty string for missing/invalid input", () => {
    expect(formatDigestDate(undefined)).toBe("");
    expect(formatDigestDate("not-a-date")).toBe("");
  });
});

describe("directionArrow", () => {
  it("maps direction to an arrow glyph", () => {
    expect(directionArrow("up")).toBe("▲");
    expect(directionArrow("down")).toBe("▼");
    expect(directionArrow("flat")).toBe("—");
  });
});

describe("deltaLabel", () => {
  it("prefixes positive deltas with +", () => {
    expect(deltaLabel({ current: 1, previous: 1, delta_pct: 12.3, direction: "up" })).toBe(
      "+12.3%"
    );
  });
  it("keeps the native minus for negatives and returns n/a without a baseline", () => {
    expect(deltaLabel({ current: 1, previous: 2, delta_pct: -5, direction: "down" })).toBe(
      "-5%"
    );
    expect(deltaLabel({ current: 1, previous: 0, delta_pct: null, direction: "up" })).toBe(
      "n/a"
    );
    expect(deltaLabel(undefined)).toBe("n/a");
  });
});

describe("formatDuration", () => {
  it("formats sub-minute, minute and minute+second durations", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(120)).toBe("2m");
    expect(formatDuration(95)).toBe("1m 35s");
    expect(formatDuration(null)).toBe("0s");
  });
});

describe("buildKpiRows", () => {
  const rows = buildKpiRows(makeDigest());

  it("emits six rows in a stable order", () => {
    expect(rows.map((r) => r.key)).toEqual([
      "unique_visitors",
      "pageviews",
      "sessions",
      "bounce_rate",
      "avg_session_duration",
      "pages_per_session",
    ]);
  });

  it("renders counts as integers with a signed delta + arrow", () => {
    const visitors = rows.find((r) => r.key === "unique_visitors")!;
    expect(visitors.value).toBe("150");
    expect(visitors.delta).toBe("+25%"); // (150-120)/120
    expect(visitors.arrow).toBe("▲");
  });

  it("renders bounce rate as a percentage and session as duration", () => {
    expect(rows.find((r) => r.key === "bounce_rate")!.value).toBe("42%");
    expect(rows.find((r) => r.key === "avg_session_duration")!.value).toBe("1m 35s");
    expect(rows.find((r) => r.key === "pages_per_session")!.value).toBe("3.3");
  });
});

describe("digestHasData", () => {
  it("is true when any headline traffic count is positive", () => {
    expect(digestHasData(makeDigest())).toBe(true);
  });

  it("is false when visitors, pageviews and sessions are all zero", () => {
    const empty = makeDigest({
      kpis: buildDigestKpis(ZERO_STATS, ZERO_STATS),
    });
    expect(digestHasData(empty)).toBe(false);
  });

  it("is true when only one of the three headline counts is positive", () => {
    const sessionsOnly = makeDigest({
      kpis: buildDigestKpis(
        { ...ZERO_STATS, total_sessions: 4 },
        ZERO_STATS
      ),
    });
    expect(digestHasData(sessionsOnly)).toBe(true);
  });
});

describe("buildPartnerDigestTemplateData", () => {
  const data = buildPartnerDigestTemplateData({
    partner: { name: "Acme Co", handle: "acme" },
    admin: { first_name: "Jo", last_name: "Doe", email: "jo@acme.com" },
    digest: makeDigest(),
    dashboardUrl: "https://dash.example.com/",
    storeUrl: "https://shop.example.com",
    year: 2026,
  });

  it("flattens identity, website + period scalars to strings", () => {
    expect(data.partner_name).toBe("Acme Co");
    expect(data.admin_name).toBe("Jo Doe");
    expect(data.website_domain).toBe("shop.example.com");
    expect(data.website_name).toBe("Example Shop");
    expect(data.period_label).toBe("last_7_days");
    expect(data.period_start).toBe("Jun 14, 2026");
    expect(data.period_end).toBe("Jun 21, 2026");
    expect(data.current_year).toBe("2026");
  });

  it("strips a trailing slash off the dashboard CTA base", () => {
    expect(data.dashboard_url).toBe("https://dash.example.com");
  });

  it("passes arrays through for {{#each}} and exposes suggestion flags", () => {
    expect(Array.isArray(data.kpi_rows)).toBe(true);
    expect(data.kpi_rows).toHaveLength(6);
    expect(data.top_pages).toHaveLength(1);
    expect(data.has_suggestions).toBe(true);
    expect(data.suggestions_count).toBe("1");
    expect(data.visitors_count).toBe("150");
    expect(data.not_found_count).toBe("3");
    expect(data.has_data).toBe(true);
  });

  it("sets has_data=false for a live storefront with zero traffic (nudge state)", () => {
    const zero = buildPartnerDigestTemplateData({
      partner: { name: "Acme Co", handle: "acme" },
      admin: { first_name: "Jo", last_name: "Doe", email: "jo@acme.com" },
      digest: makeDigest({ kpis: buildDigestKpis(ZERO_STATS, ZERO_STATS) }),
      storeUrl: "https://shop.example.com",
      year: 2026,
    });
    expect(zero.has_data).toBe(false);
    // KPI rows are still assembled — the template just hides them via {{#if has_data}}.
    expect(zero.website_name).toBe("Example Shop");
    expect(zero.store_url).toBe("https://shop.example.com");
  });

  it("falls back gracefully when partner/website fields are missing", () => {
    const bare = buildPartnerDigestTemplateData({
      partner: {},
      admin: {},
      digest: makeDigest({ website: null, suggestions: [] }),
      year: 2026,
    });
    expect(bare.partner_name).toBe("Partner");
    expect(bare.admin_name).toBe("");
    expect(bare.website_name).toBe("your storefront");
    expect(bare.has_website).toBe(false);
    expect(bare.has_suggestions).toBe(false);
    expect(bare.dashboard_url).toBe("");
  });

  it("omits the AI summary by default (no ai-extract enrichment yet)", () => {
    expect(data.ai_summary).toBe("");
    expect(data.has_ai_summary).toBe(false);
  });

  it("surfaces a sanitized AI summary + has_ai_summary flag when present", () => {
    const withAi = buildPartnerDigestTemplateData({
      partner: { name: "Acme Co", handle: "acme" },
      admin: { first_name: "Jo", last_name: "Doe", email: "jo@acme.com" },
      digest: makeDigest({ ai_summary: "  Traffic\n  jumped 25%   this week.  " }),
      year: 2026,
    });
    expect(withAi.ai_summary).toBe("Traffic jumped 25% this week.");
    expect(withAi.has_ai_summary).toBe(true);
  });
});

describe("sanitizeAiSummary", () => {
  it("collapses whitespace/newlines and trims", () => {
    expect(sanitizeAiSummary("  Visitors\n\trose   sharply.  ")).toBe(
      "Visitors rose sharply."
    );
  });

  it("returns '' for non-strings and blank/whitespace input", () => {
    expect(sanitizeAiSummary(undefined)).toBe("");
    expect(sanitizeAiSummary(null)).toBe("");
    expect(sanitizeAiSummary(42)).toBe("");
    expect(sanitizeAiSummary("   \n  ")).toBe("");
  });

  it("strips control characters", () => {
    expect(sanitizeAiSummary("a\u0001b\u0002c")).toBe("a b c");
  });

  it("hard-caps an over-long summary on a word boundary with an ellipsis", () => {
    const long = `${"word ".repeat(200)}end`; // ~1003 chars
    const out = sanitizeAiSummary(long);
    expect(out.length).toBeLessThanOrEqual(AI_SUMMARY_MAX_LEN + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/wor…$/); // no mid-word cut
  });

  it("leaves a summary at/under the cap untouched", () => {
    const short = "Solid week — conversions up.";
    expect(sanitizeAiSummary(short)).toBe(short);
  });
});
