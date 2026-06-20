import {
  BREAKDOWN_DIMENSIONS,
  buildBreakdownQuery,
  isBreakdownDimension,
} from "../analytics-breakdown-query";

/**
 * Helper: parse the built query string back into a sorted [key, value] list so
 * assertions don't depend on URLSearchParams ordering.
 */
const parse = (qs: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(qs).entries()) out[k] = v;
  return out;
};

describe("buildBreakdownQuery", () => {
  it("always includes website_id and dimension", () => {
    const q = parse(
      buildBreakdownQuery({ website_id: "web_1", dimension: "country" })
    );
    expect(q.website_id).toBe("web_1");
    expect(q.dimension).toBe("country");
  });

  it("includes a rolling days window when provided", () => {
    const q = parse(
      buildBreakdownQuery({ website_id: "web_1", dimension: "browser", days: 30 })
    );
    expect(q.days).toBe("30");
    expect(q.start_date).toBeUndefined();
    expect(q.end_date).toBeUndefined();
  });

  it("includes explicit start/end when no days given", () => {
    const q = parse(
      buildBreakdownQuery({
        website_id: "web_1",
        dimension: "os",
        start_date: "2026-06-01T00:00:00.000Z",
        end_date: "2026-06-20T00:00:00.000Z",
      })
    );
    expect(q.start_date).toBe("2026-06-01T00:00:00.000Z");
    expect(q.end_date).toBe("2026-06-20T00:00:00.000Z");
    expect(q.days).toBeUndefined();
  });

  it("prefers days over explicit start/end (server precedence) and never sends both", () => {
    const q = parse(
      buildBreakdownQuery({
        website_id: "web_1",
        dimension: "pathname",
        days: 7,
        start_date: "2026-06-01T00:00:00.000Z",
        end_date: "2026-06-20T00:00:00.000Z",
      })
    );
    expect(q.days).toBe("7");
    expect(q.start_date).toBeUndefined();
    expect(q.end_date).toBeUndefined();
  });

  it("includes a numeric limit", () => {
    const q = parse(
      buildBreakdownQuery({ website_id: "web_1", dimension: "country", limit: 50 })
    );
    expect(q.limit).toBe("50");
  });

  it("ignores a non-finite limit / days", () => {
    const q = parse(
      buildBreakdownQuery({
        website_id: "web_1",
        dimension: "country",
        limit: NaN,
        days: NaN,
      })
    );
    expect(q.limit).toBeUndefined();
    expect(q.days).toBeUndefined();
  });

  it("appends recognized composable equality filters", () => {
    const q = parse(
      buildBreakdownQuery({
        website_id: "web_1",
        dimension: "pathname",
        filters: { device_type: "mobile", country: "IN" },
      })
    );
    expect(q.device_type).toBe("mobile");
    expect(q.country).toBe("IN");
  });

  it("coerces boolean/number filter values to strings", () => {
    const q = parse(
      buildBreakdownQuery({
        website_id: "web_1",
        dimension: "pathname",
        filters: { is_404: true },
      })
    );
    expect(q.is_404).toBe("true");
  });

  it("drops blank / whitespace-only filter values", () => {
    const q = parse(
      buildBreakdownQuery({
        website_id: "web_1",
        dimension: "pathname",
        filters: { country: "", device_type: "   " },
      })
    );
    expect(q.country).toBeUndefined();
    expect(q.device_type).toBeUndefined();
  });

  it("ignores unrecognized filter keys", () => {
    const q = parse(
      buildBreakdownQuery({
        website_id: "web_1",
        dimension: "country",
        // @ts-expect-error — intentionally passing a non-filterable key
        filters: { not_a_field: "x" },
      })
    );
    expect(q.not_a_field).toBeUndefined();
  });
});

describe("isBreakdownDimension", () => {
  it("accepts every supported dimension", () => {
    for (const d of BREAKDOWN_DIMENSIONS) {
      expect(isBreakdownDimension(d)).toBe(true);
    }
  });

  it("rejects unknown values and non-strings", () => {
    expect(isBreakdownDimension("nonsense")).toBe(false);
    expect(isBreakdownDimension(undefined)).toBe(false);
    expect(isBreakdownDimension(42)).toBe(false);
    expect(isBreakdownDimension(null)).toBe(false);
  });
});
