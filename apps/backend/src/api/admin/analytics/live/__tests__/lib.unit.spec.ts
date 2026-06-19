import {
  computeLiveStats,
  resolveLiveRefreshMs,
  LIVE_WINDOW_MS,
  type LiveAnalyticsEvent,
} from "../lib";

/**
 * Unit coverage for the live-analytics pure helpers (#344 slice 3 — lightweight,
 * multi-instance-safe DB-poll refresh). No DI / timers / SSE stream involved.
 */

const ev = (over: Partial<LiveAnalyticsEvent>): LiveAnalyticsEvent => ({
  id: over.id ?? "evt",
  pathname: "/",
  timestamp: "2026-06-19T12:00:00.000Z",
  visitor_id: "v1",
  session_id: "s1",
  ...over,
});

describe("computeLiveStats", () => {
  it("counts distinct sessions and visitors", () => {
    const stats = computeLiveStats([
      ev({ id: "a", visitor_id: "v1", session_id: "s1" }),
      ev({ id: "b", visitor_id: "v1", session_id: "s1" }), // same visitor+session
      ev({ id: "c", visitor_id: "v2", session_id: "s2" }),
      ev({ id: "d", visitor_id: "v2", session_id: "s3" }), // same visitor, new session
    ]);
    expect(stats.currentVisitors).toBe(3); // s1, s2, s3
    expect(stats.uniqueVisitors).toBe(2); // v1, v2
  });

  it("returns an empty snapshot for no events", () => {
    expect(computeLiveStats([])).toEqual({
      currentVisitors: 0,
      uniqueVisitors: 0,
      recentEvents: [],
      activePages: [],
    });
  });

  it("ignores empty/missing visitor and session ids when counting", () => {
    const stats = computeLiveStats([
      ev({ id: "a", visitor_id: "", session_id: "" }),
      ev({ id: "b", visitor_id: null as any, session_id: undefined as any }),
      ev({ id: "c", visitor_id: "v1", session_id: "s1" }),
    ]);
    expect(stats.currentVisitors).toBe(1);
    expect(stats.uniqueVisitors).toBe(1);
  });

  it("attributes each visitor to their LATEST page and ranks pages by count", () => {
    const stats = computeLiveStats([
      ev({ id: "1", visitor_id: "v1", pathname: "/a", timestamp: "2026-06-19T12:00:00Z" }),
      ev({ id: "2", visitor_id: "v1", pathname: "/b", timestamp: "2026-06-19T12:01:00Z" }), // v1 now on /b
      ev({ id: "3", visitor_id: "v2", pathname: "/b", timestamp: "2026-06-19T12:00:30Z" }),
      ev({ id: "4", visitor_id: "v3", pathname: "/c", timestamp: "2026-06-19T12:00:10Z" }),
    ]);
    // /b has v1 (latest) + v2 = 2; /c has v3 = 1; /a no longer current for anyone
    expect(stats.activePages).toEqual([
      { page: "/b", count: 2 },
      { page: "/c", count: 1 },
    ]);
  });

  it("returns recentEvents newest-first, capped at 10", () => {
    const events: LiveAnalyticsEvent[] = Array.from({ length: 15 }, (_, i) =>
      ev({
        id: `e${i}`,
        visitor_id: `v${i}`,
        session_id: `s${i}`,
        timestamp: new Date(Date.UTC(2026, 5, 19, 12, 0, i)).toISOString(),
      })
    );
    const stats = computeLiveStats(events);
    expect(stats.recentEvents).toHaveLength(10);
    expect(stats.recentEvents[0].id).toBe("e14"); // newest first
    expect(stats.recentEvents[9].id).toBe("e5");
  });

  it("does not mutate the input array", () => {
    const events = [
      ev({ id: "old", timestamp: "2026-06-19T12:00:00Z" }),
      ev({ id: "new", timestamp: "2026-06-19T12:05:00Z" }),
    ];
    const snapshot = [...events];
    computeLiveStats(events);
    expect(events.map((e) => e.id)).toEqual(snapshot.map((e) => e.id));
  });

  it("tolerates Date instances and string timestamps interchangeably", () => {
    const stats = computeLiveStats([
      ev({ id: "a", visitor_id: "v1", session_id: "s1", timestamp: new Date("2026-06-19T12:00:00Z") }),
      ev({ id: "b", visitor_id: "v2", session_id: "s2", timestamp: "2026-06-19T12:01:00Z" }),
    ]);
    expect(stats.recentEvents[0].id).toBe("b"); // 12:01 newer than 12:00
    expect(stats.currentVisitors).toBe(2);
  });
});

describe("resolveLiveRefreshMs", () => {
  it("defaults to 15s when unset or invalid", () => {
    expect(resolveLiveRefreshMs(undefined)).toBe(15000);
    expect(resolveLiveRefreshMs("")).toBe(15000);
    expect(resolveLiveRefreshMs("not-a-number")).toBe(15000);
    expect(resolveLiveRefreshMs("0")).toBe(15000);
    expect(resolveLiveRefreshMs("-100")).toBe(15000);
  });

  it("honours a valid override but never polls faster than 5s", () => {
    expect(resolveLiveRefreshMs("30000")).toBe(30000);
    expect(resolveLiveRefreshMs("1000")).toBe(5000); // clamped to floor
    expect(resolveLiveRefreshMs("8000")).toBe(8000);
  });
});

describe("LIVE_WINDOW_MS", () => {
  it("is a 5-minute active window", () => {
    expect(LIVE_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});
