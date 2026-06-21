import { computeSessionMetrics } from "../session-metrics-lib";

describe("computeSessionMetrics (#569 S1)", () => {
  it("returns zeroed metrics for empty / nullish input", () => {
    const empty = computeSessionMetrics([]);
    expect(empty).toEqual({
      total_sessions: 0,
      bounce_rate: 0,
      avg_session_duration: 0,
      pages_per_session: 0,
      views_per_visitor: 0,
    });
    expect(computeSessionMetrics(null)).toEqual(empty);
    expect(computeSessionMetrics(undefined)).toEqual(empty);
  });

  it("computes bounce_rate as bounced / total (0..1, 4dp)", () => {
    const m = computeSessionMetrics([
      { is_bounce: true },
      { is_bounce: false },
      { is_bounce: true },
    ]);
    expect(m.total_sessions).toBe(3);
    expect(m.bounce_rate).toBe(0.6667);
  });

  it("averages duration only over sessions with duration > 0", () => {
    const m = computeSessionMetrics([
      { duration_seconds: 100 },
      { duration_seconds: 0 }, // excluded
      { duration_seconds: null }, // excluded
      { duration_seconds: 200 },
    ]);
    // (100 + 200) / 2 = 150
    expect(m.avg_session_duration).toBe(150);
  });

  it("returns 0 avg_session_duration when no positive durations", () => {
    const m = computeSessionMetrics([
      { duration_seconds: 0 },
      { duration_seconds: null },
    ]);
    expect(m.avg_session_duration).toBe(0);
  });

  it("computes pages_per_session as mean pageviews across all sessions (2dp)", () => {
    const m = computeSessionMetrics([
      { pageviews: 1 },
      { pageviews: 2 },
      { pageviews: 4 },
    ]);
    // 7 / 3 = 2.3333 -> 2.33
    expect(m.pages_per_session).toBe(2.33);
  });

  it("treats missing / non-positive pageviews as 0", () => {
    const m = computeSessionMetrics([
      { pageviews: null },
      { pageviews: 0 },
      { pageviews: 3 },
    ]);
    // 3 / 3 = 1
    expect(m.pages_per_session).toBe(1);
  });

  it("computes views_per_visitor as total pageviews / unique visitors (2dp)", () => {
    const m = computeSessionMetrics([
      { visitor_id: "v1", pageviews: 2 },
      { visitor_id: "v1", pageviews: 3 }, // same visitor
      { visitor_id: "v2", pageviews: 5 },
    ]);
    // total pv = 10, unique visitors = 2 -> 5
    expect(m.views_per_visitor).toBe(5);
  });

  it("returns 0 views_per_visitor when no visitor ids present", () => {
    const m = computeSessionMetrics([{ pageviews: 4 }, { pageviews: 6 }]);
    expect(m.views_per_visitor).toBe(0);
  });

  it("handles a realistic mixed batch", () => {
    const m = computeSessionMetrics([
      { visitor_id: "a", pageviews: 1, duration_seconds: 0, is_bounce: true },
      { visitor_id: "b", pageviews: 5, duration_seconds: 120, is_bounce: false },
      { visitor_id: "a", pageviews: 3, duration_seconds: 60, is_bounce: false },
    ]);
    expect(m.total_sessions).toBe(3);
    expect(m.bounce_rate).toBe(0.3333);
    expect(m.avg_session_duration).toBe(90); // (120+60)/2
    expect(m.pages_per_session).toBe(3); // (1+5+3)/3
    expect(m.views_per_visitor).toBe(4.5); // 9 / 2 visitors
  });
});
