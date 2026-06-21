import { computeSessionMetrics } from "../session-metrics-lib";

describe("computeSessionMetrics — edge cases", () => {
  it("excludes falsy empty-string visitor_id from unique visitors", () => {
    const m = computeSessionMetrics([{ visitor_id: "", pageviews: 4 }]);
    expect(m.total_sessions).toBe(1);
    expect(m.pages_per_session).toBe(4);
    expect(m.views_per_visitor).toBe(0);
    expect(m.bounce_rate).toBe(0);
    expect(m.avg_session_duration).toBe(0);
  });

  it("counts numeric-string pageviews", () => {
    const m = computeSessionMetrics([{ pageviews: "5" as any }]);
    expect(m.pages_per_session).toBe(5);
    expect(m.total_sessions).toBe(1);
  });

  it("ignores negative pageviews", () => {
    const m = computeSessionMetrics([{ pageviews: -3 }, { pageviews: 6 }]);
    expect(m.pages_per_session).toBe(3);
    expect(m.total_sessions).toBe(2);
  });

  it("ignores negative durations and counts numeric-string durations", () => {
    const m = computeSessionMetrics([
      { duration_seconds: -50 },
      { duration_seconds: "60" as any },
      { duration_seconds: 90 },
    ]);
    expect(m.avg_session_duration).toBe(75);
  });

  it("only counts is_bounce strictly equal to true (not truthy 1 or string)", () => {
    const m = computeSessionMetrics([
      { is_bounce: 1 as any },
      { is_bounce: "true" as any },
      { is_bounce: true },
    ]);
    expect(m.bounce_rate).toBe(0.3333);
    expect(m.total_sessions).toBe(3);
  });

  it("dedupes visitor ids after String() coercion", () => {
    const m = computeSessionMetrics([
      { visitor_id: 123 as any, pageviews: 2 },
      { visitor_id: "123", pageviews: 2 },
    ]);
    expect(m.views_per_visitor).toBe(4);
    expect(m.total_sessions).toBe(2);
  });

  it("rounds bounce_rate to 4 decimal places", () => {
    const rows = [
      { is_bounce: true },
      { is_bounce: true },
      { is_bounce: false },
      { is_bounce: false },
      { is_bounce: false },
      { is_bounce: false },
      { is_bounce: false },
    ];
    const m = computeSessionMetrics(rows);
    expect(m.bounce_rate).toBe(0.2857);
    expect(m.total_sessions).toBe(7);
  });

  it("treats non-numeric-string pageviews as zero", () => {
    const m = computeSessionMetrics([{ pageviews: "abc" as any }, { pageviews: 3 }]);
    expect(m.pages_per_session).toBe(1.5);
    expect(m.total_sessions).toBe(2);
  });
});
