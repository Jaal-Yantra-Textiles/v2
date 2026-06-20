import {
  applyEventFilters,
  computeBreakdown,
  isBreakdownDimension,
  isFilterableField,
  normalizeFieldValue,
  BREAKDOWN_DIMENSIONS,
  DEFAULT_BREAKDOWN_LIMIT,
  MAX_BREAKDOWN_LIMIT,
  type AnalyticsEventRow,
} from "../breakdown-lib";

const ev = (over: Partial<AnalyticsEventRow> = {}): AnalyticsEventRow => ({
  visitor_id: "v1",
  session_id: "s1",
  country: "IN",
  device_type: "desktop",
  browser: "Chrome",
  os: "macOS",
  referrer_source: "google",
  pathname: "/",
  is_404: false,
  event_type: "pageview",
  ...over,
});

describe("isBreakdownDimension / isFilterableField", () => {
  it("accepts every supported dimension", () => {
    for (const d of BREAKDOWN_DIMENSIONS) {
      expect(isBreakdownDimension(d)).toBe(true);
      expect(isFilterableField(d)).toBe(true);
    }
  });

  it("rejects unknown / non-string values", () => {
    expect(isBreakdownDimension("visitor_id")).toBe(false);
    expect(isBreakdownDimension("")).toBe(false);
    expect(isBreakdownDimension(undefined)).toBe(false);
    expect(isBreakdownDimension(42)).toBe(false);
  });
});

describe("normalizeFieldValue", () => {
  it("maps null referrer_source to 'direct'", () => {
    expect(normalizeFieldValue("referrer_source", null)).toBe("direct");
  });

  it("maps null/empty referrer (full URL) to 'direct'", () => {
    expect(normalizeFieldValue("referrer", null)).toBe("direct");
    expect(normalizeFieldValue("referrer", "")).toBe("direct");
  });

  it("keeps the full referrer URL verbatim when present", () => {
    expect(normalizeFieldValue("referrer", "https://t.co/abc?x=1")).toBe(
      "https://t.co/abc?x=1"
    );
  });

  it("maps null/empty country to 'unknown'", () => {
    expect(normalizeFieldValue("country", null)).toBe("unknown");
    expect(normalizeFieldValue("country", "")).toBe("unknown");
  });

  it("maps generic null fields to '(none)'", () => {
    expect(normalizeFieldValue("utm_campaign", null)).toBe("(none)");
    expect(normalizeFieldValue("pathname", undefined)).toBe("(none)");
  });

  it("coerces is_404 to a boolean string from bool or string input", () => {
    expect(normalizeFieldValue("is_404", true)).toBe("true");
    expect(normalizeFieldValue("is_404", "true")).toBe("true");
    expect(normalizeFieldValue("is_404", false)).toBe("false");
    expect(normalizeFieldValue("is_404", null)).toBe("false");
  });

  it("stringifies present values", () => {
    expect(normalizeFieldValue("browser", "Firefox")).toBe("Firefox");
  });
});

describe("applyEventFilters", () => {
  const events = [
    ev({ country: "IN", device_type: "mobile" }),
    ev({ country: "US", device_type: "desktop" }),
    ev({ country: "IN", device_type: "desktop" }),
    ev({ country: null, referrer_source: null }),
  ];

  it("returns a copy when no active filters", () => {
    const out = applyEventFilters(events, {});
    expect(out).toHaveLength(events.length);
    expect(out).not.toBe(events);
  });

  it("filters by a single equality field", () => {
    expect(applyEventFilters(events, { country: "IN" })).toHaveLength(2);
  });

  it("composes multiple filters with AND semantics", () => {
    const out = applyEventFilters(events, { country: "IN", device_type: "desktop" });
    expect(out).toHaveLength(1);
  });

  it("matches null rows by their canonical label", () => {
    expect(applyEventFilters(events, { country: "unknown" })).toHaveLength(1);
    expect(applyEventFilters(events, { referrer_source: "direct" })).toHaveLength(1);
  });

  it("ignores unknown / empty filter keys", () => {
    expect(applyEventFilters(events, { visitor_id: "v1" } as any)).toHaveLength(events.length);
    expect(applyEventFilters(events, { country: "" })).toHaveLength(events.length);
  });
});

describe("computeBreakdown", () => {
  it("groups by dimension with counts, unique visitors and percentages", () => {
    const events = [
      ev({ browser: "Chrome", visitor_id: "a" }),
      ev({ browser: "Chrome", visitor_id: "a" }),
      ev({ browser: "Chrome", visitor_id: "b" }),
      ev({ browser: "Safari", visitor_id: "c" }),
    ];
    const out = computeBreakdown(events, "browser");
    expect(out.dimension).toBe("browser");
    expect(out.total_events).toBe(4);
    expect(out.total_unique_visitors).toBe(3);

    const chrome = out.results.find((r) => r.value === "Chrome")!;
    expect(chrome.count).toBe(3);
    expect(chrome.unique_visitors).toBe(2);
    expect(chrome.percentage).toBe(75);

    const safari = out.results.find((r) => r.value === "Safari")!;
    expect(safari.count).toBe(1);
    expect(safari.percentage).toBe(25);
  });

  it("sorts by count desc then value asc", () => {
    const events = [
      ev({ country: "B" }),
      ev({ country: "A" }),
      ev({ country: "A" }),
      ev({ country: "C" }),
    ];
    const out = computeBreakdown(events, "country");
    expect(out.results.map((r) => r.value)).toEqual(["A", "B", "C"]);
  });

  it("buckets null dimension values under their label", () => {
    const events = [ev({ referrer_source: null }), ev({ referrer_source: "google" })];
    const out = computeBreakdown(events, "referrer_source");
    expect(out.results.map((r) => r.value).sort()).toEqual(["direct", "google"]);
  });

  it("breaks down by full referrer URL, folding null into 'direct'", () => {
    const events = [
      ev({ referrer: "https://google.com/search?q=a", visitor_id: "a" }),
      ev({ referrer: "https://google.com/search?q=a", visitor_id: "b" }),
      ev({ referrer: "https://t.co/xyz", visitor_id: "c" }),
      ev({ referrer: null, visitor_id: "d" }),
    ];
    const out = computeBreakdown(events, "referrer");
    expect(out.dimension).toBe("referrer");
    expect(out.total_events).toBe(4);

    const g = out.results.find((r) => r.value === "https://google.com/search?q=a")!;
    expect(g.count).toBe(2);
    expect(g.unique_visitors).toBe(2);

    const direct = out.results.find((r) => r.value === "direct")!;
    expect(direct.count).toBe(1);
  });

  it("handles is_404 boolean buckets", () => {
    const events = [ev({ is_404: true }), ev({ is_404: false }), ev({ is_404: false })];
    const out = computeBreakdown(events, "is_404");
    const t = out.results.find((r) => r.value === "true")!;
    const f = out.results.find((r) => r.value === "false")!;
    expect(t.count).toBe(1);
    expect(f.count).toBe(2);
  });

  it("respects the limit and clamps to bounds", () => {
    const events = Array.from({ length: 5 }, (_, i) => ev({ pathname: `/p${i}` }));
    expect(computeBreakdown(events, "pathname", 2).results).toHaveLength(2);
    // limit 0 / NaN falls back to default
    expect(computeBreakdown(events, "pathname", 0).results.length).toBeLessThanOrEqual(DEFAULT_BREAKDOWN_LIMIT);
    // over-max is clamped, never throws
    expect(() => computeBreakdown(events, "pathname", MAX_BREAKDOWN_LIMIT + 50)).not.toThrow();
  });

  it("returns empty results and zero totals for no events", () => {
    const out = computeBreakdown([], "device_type");
    expect(out.total_events).toBe(0);
    expect(out.total_unique_visitors).toBe(0);
    expect(out.results).toEqual([]);
  });
});
