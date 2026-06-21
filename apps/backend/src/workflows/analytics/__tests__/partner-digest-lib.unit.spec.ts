import {
  breakdownToItems,
  buildDigestKpis,
  buildDigestSuggestions,
  computeDigestMetric,
  DEFAULT_DIGEST_THRESHOLDS,
  resolvePeriodRange,
  type DigestBreakdowns,
  type DigestKpis,
} from "../partner-digest-lib";

// Helper to build a full kpis block tersely.
const metric = (current: number, previous: number) =>
  computeDigestMetric(current, previous);

const kpis = (over: Partial<Record<keyof DigestKpis, [number, number]>> = {}): DigestKpis => ({
  unique_visitors: metric(...(over.unique_visitors ?? [100, 100])),
  pageviews: metric(...(over.pageviews ?? [300, 300])),
  sessions: metric(...(over.sessions ?? [120, 120])),
  bounce_rate: metric(...(over.bounce_rate ?? [0.3, 0.3])),
  avg_session_duration: metric(...(over.avg_session_duration ?? [60, 60])),
  pages_per_session: metric(...(over.pages_per_session ?? [3, 3])),
});

const breakdowns = (over: Partial<DigestBreakdowns> = {}): DigestBreakdowns => ({
  top_pages: over.top_pages ?? [],
  referrers: over.referrers ?? [],
  devices: over.devices ?? [],
  countries: over.countries ?? [],
});

describe("resolvePeriodRange", () => {
  const now = new Date("2026-06-21T00:00:00.000Z");

  it("resolves last_7_days into current + equal-length previous windows", () => {
    const r = resolvePeriodRange("last_7_days", now);
    expect(r.days).toBe(7);
    expect(r.label).toBe("last_7_days");
    expect(r.current.end).toBe("2026-06-21T00:00:00.000Z");
    expect(r.current.start).toBe("2026-06-14T00:00:00.000Z");
    // previous window abuts the current start, equal length
    expect(r.previous.end).toBe("2026-06-14T00:00:00.000Z");
    expect(r.previous.start).toBe("2026-06-07T00:00:00.000Z");
  });

  it("supports named 28/30-day periods", () => {
    expect(resolvePeriodRange("last_28_days", now).days).toBe(28);
    expect(resolvePeriodRange("last_30_days", now).days).toBe(30);
  });

  it("supports an explicit {days} period and labels it", () => {
    const r = resolvePeriodRange({ days: 14 }, now);
    expect(r.days).toBe(14);
    expect(r.label).toBe("last_14_days");
  });

  it("falls back to 7 days for invalid day counts", () => {
    expect(resolvePeriodRange({ days: 0 }, now).days).toBe(7);
    expect(resolvePeriodRange({ days: -5 }, now).days).toBe(7);
    expect(resolvePeriodRange({ days: NaN }, now).days).toBe(7);
  });
});

describe("computeDigestMetric", () => {
  it("computes positive delta + up direction", () => {
    const m = computeDigestMetric(150, 100);
    expect(m).toEqual({ current: 150, previous: 100, delta_pct: 50, direction: "up" });
  });

  it("computes negative delta + down direction", () => {
    const m = computeDigestMetric(80, 100);
    expect(m).toEqual({ current: 80, previous: 100, delta_pct: -20, direction: "down" });
  });

  it("is flat when equal", () => {
    expect(computeDigestMetric(100, 100).direction).toBe("flat");
    expect(computeDigestMetric(100, 100).delta_pct).toBe(0);
  });

  it("returns null delta with no baseline but marks up when current > 0", () => {
    const m = computeDigestMetric(40, 0);
    expect(m.delta_pct).toBeNull();
    expect(m.direction).toBe("up");
  });

  it("returns flat null when both zero", () => {
    const m = computeDigestMetric(0, 0);
    expect(m.delta_pct).toBeNull();
    expect(m.direction).toBe("flat");
  });

  it("coerces non-numeric/garbage to 0", () => {
    expect(computeDigestMetric(undefined, null)).toEqual({
      current: 0,
      previous: 0,
      delta_pct: null,
      direction: "flat",
    });
  });

  it("rounds delta to 1 dp", () => {
    expect(computeDigestMetric(1, 3).delta_pct).toBe(-66.7);
  });
});

describe("buildDigestKpis", () => {
  it("maps overview stats into delta-annotated KPIs", () => {
    const out = buildDigestKpis(
      { unique_visitors: 120, total_pageviews: 400, bounce_rate: 0.5 },
      { unique_visitors: 100, total_pageviews: 500, bounce_rate: 0.4 }
    );
    expect(out.unique_visitors).toMatchObject({ current: 120, previous: 100, direction: "up" });
    expect(out.pageviews.direction).toBe("down");
    expect(out.bounce_rate.current).toBe(0.5);
  });

  it("handles null inputs without throwing", () => {
    const out = buildDigestKpis(null, undefined);
    expect(out.unique_visitors.current).toBe(0);
    expect(out.bounce_rate.delta_pct).toBeNull();
  });
});

describe("breakdownToItems", () => {
  it("maps top-N rows and coerces types", () => {
    const items = breakdownToItems(
      {
        total_events: 10,
        results: [
          { value: "/home", count: 6, percentage: 60 },
          { value: "/about", count: 4, percentage: 40 },
        ],
      },
      5
    );
    expect(items).toEqual([
      { value: "/home", count: 6, percentage: 60 },
      { value: "/about", count: 4, percentage: 40 },
    ]);
  });

  it("limits to N and labels null values", () => {
    const items = breakdownToItems(
      { results: [{ value: null, count: 3, percentage: 100 }, { value: "x", count: 1, percentage: 0 }] },
      1
    );
    expect(items).toHaveLength(1);
    expect(items[0].value).toBe("(none)");
  });

  it("returns [] for missing/empty input", () => {
    expect(breakdownToItems(null)).toEqual([]);
    expect(breakdownToItems({})).toEqual([]);
    expect(breakdownToItems({ results: [] })).toEqual([]);
  });
});

describe("buildDigestSuggestions", () => {
  const ids = (s: ReturnType<typeof buildDigestSuggestions>) => s.map((x) => x.id);

  it("returns no suggestions for a healthy storefront", () => {
    const out = buildDigestSuggestions({
      kpis: kpis(),
      breakdowns: breakdowns({ devices: [{ value: "desktop", count: 100, percentage: 100 }] }),
      not_found_count: 0,
    });
    expect(out).toEqual([]);
  });

  it("flags high bounce rate", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ bounce_rate: [0.75, 0.7] }),
      breakdowns: breakdowns(),
      not_found_count: 0,
    });
    expect(ids(out)).toContain("bounce_rate_high");
  });

  it("flags a sharply rising bounce rate even below the absolute threshold", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ bounce_rate: [0.5, 0.3] }), // +66% up
      breakdowns: breakdowns(),
      not_found_count: 0,
    });
    expect(ids(out)).toContain("bounce_rate_high");
  });

  it("flags mobile-heavy traffic with enough sample", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ unique_visitors: [50, 40] }),
      breakdowns: breakdowns({
        devices: [
          { value: "mobile", count: 70, percentage: 70 },
          { value: "desktop", count: 30, percentage: 30 },
        ],
      }),
      not_found_count: 0,
    });
    expect(ids(out)).toContain("mobile_heavy_traffic");
  });

  it("suppresses sample-gated rules on tiny traffic", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ unique_visitors: [5, 4] }), // below minVisitorsForRules
      breakdowns: breakdowns({
        devices: [{ value: "mobile", count: 5, percentage: 100 }],
        referrers: [{ value: "google", count: 5, percentage: 100 }],
      }),
      not_found_count: 0,
    });
    expect(ids(out)).not.toContain("mobile_heavy_traffic");
    expect(ids(out)).not.toContain("single_top_referrer");
  });

  it("suggests leaning into a single dominant referrer", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ unique_visitors: [60, 50] }),
      breakdowns: breakdowns({
        referrers: [{ value: "instagram", count: 50, percentage: 80 }],
      }),
      not_found_count: 0,
    });
    const s = out.find((x) => x.id === "single_top_referrer");
    expect(s).toBeTruthy();
    expect(s!.title).toContain("instagram");
  });

  it("does not lean into a '(none)' referrer", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ unique_visitors: [60, 50] }),
      breakdowns: breakdowns({ referrers: [{ value: "(none)", count: 50, percentage: 90 }] }),
      not_found_count: 0,
    });
    expect(ids(out)).not.toContain("single_top_referrer");
  });

  it("flags a low-engagement dominant top page", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ unique_visitors: [60, 50], pages_per_session: [1.2, 1.3] }),
      breakdowns: breakdowns({ top_pages: [{ value: "/product/x", count: 40, percentage: 60 }] }),
      not_found_count: 0,
    });
    expect(ids(out)).toContain("low_engagement_top_page");
  });

  it("flags many 404s", () => {
    const out = buildDigestSuggestions({
      kpis: kpis(),
      breakdowns: breakdowns(),
      not_found_count: 12,
    });
    expect(ids(out)).toContain("many_404s");
  });

  it("suggests a promo when visitors decline beyond the drop threshold", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ unique_visitors: [70, 100] }), // -30%
      breakdowns: breakdowns(),
      not_found_count: 0,
    });
    expect(ids(out)).toContain("visitors_declining");
  });

  it("does not suggest a promo on a small dip", () => {
    const out = buildDigestSuggestions({
      kpis: kpis({ unique_visitors: [97, 100] }), // -3%
      breakdowns: breakdowns(),
      not_found_count: 0,
    });
    expect(ids(out)).not.toContain("visitors_declining");
  });

  it("honours overridden thresholds", () => {
    const lenient = buildDigestSuggestions(
      { kpis: kpis({ bounce_rate: [0.65, 0.6] }), breakdowns: breakdowns(), not_found_count: 0 },
      { ...DEFAULT_DIGEST_THRESHOLDS, bounceRateHigh: 0.9 }
    );
    expect(ids(lenient)).not.toContain("bounce_rate_high");
  });

  it("merges a partial threshold override with defaults", () => {
    // Only notFoundHigh overridden; the rest fall back to defaults.
    const out = buildDigestSuggestions(
      { kpis: kpis(), breakdowns: breakdowns(), not_found_count: 3 },
      { notFoundHigh: 2 } as any
    );
    expect(ids(out)).toContain("many_404s");
  });
});
