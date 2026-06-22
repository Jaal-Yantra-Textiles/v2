import {
  BufferedAnalyticsEvent,
  isBatchIngestEnabled,
  isHeartbeatEvent,
  orderAndDedupeBuffer,
  parseBufferedEvent,
} from "../ingest-buffer";

const ev = (over: Partial<BufferedAnalyticsEvent> = {}): BufferedAnalyticsEvent => ({
  event_id: "e1",
  website_id: "web_1",
  event_type: "pageview",
  pathname: "/",
  visitor_id: "v1",
  session_id: "s1",
  user_agent: "ua",
  ip_address: "1.2.3.4",
  timestamp: "2026-06-20T10:00:00.000Z",
  ...over,
});

describe("ingest-buffer pure helpers (#559)", () => {
  describe("isBatchIngestEnabled", () => {
    const prev = process.env.ANALYTICS_BATCH_INGEST;
    afterEach(() => {
      process.env.ANALYTICS_BATCH_INGEST = prev;
    });

    it.each(["1", "true", "TRUE", "yes", "on"])("is on for %s", (v) => {
      process.env.ANALYTICS_BATCH_INGEST = v;
      expect(isBatchIngestEnabled()).toBe(true);
    });

    it.each(["0", "false", "", "off", undefined as any])(
      "is off for %s",
      (v) => {
        if (v === undefined) delete process.env.ANALYTICS_BATCH_INGEST;
        else process.env.ANALYTICS_BATCH_INGEST = v;
        expect(isBatchIngestEnabled()).toBe(false);
      }
    );
  });

  describe("isHeartbeatEvent", () => {
    it("true only for custom_event named heartbeat", () => {
      expect(isHeartbeatEvent("custom_event", "heartbeat")).toBe(true);
    });
    it("false for pageviews and other custom events", () => {
      expect(isHeartbeatEvent("pageview", undefined)).toBe(false);
      expect(isHeartbeatEvent("custom_event", "add_to_cart")).toBe(false);
      expect(isHeartbeatEvent("custom_event", undefined)).toBe(false);
    });
  });

  describe("orderAndDedupeBuffer", () => {
    it("sorts ascending by timestamp", () => {
      const out = orderAndDedupeBuffer([
        ev({ event_id: "b", timestamp: "2026-06-20T10:00:02.000Z" }),
        ev({ event_id: "a", timestamp: "2026-06-20T10:00:01.000Z" }),
        ev({ event_id: "c", timestamp: "2026-06-20T10:00:03.000Z" }),
      ]);
      expect(out.map((e) => e.event_id)).toEqual(["a", "b", "c"]);
    });

    it("drops within-batch event_id duplicates (first wins)", () => {
      const out = orderAndDedupeBuffer([
        ev({ event_id: "dup", pathname: "/first", timestamp: "2026-06-20T10:00:01.000Z" }),
        ev({ event_id: "dup", pathname: "/second", timestamp: "2026-06-20T10:00:02.000Z" }),
        ev({ event_id: "x", timestamp: "2026-06-20T10:00:03.000Z" }),
      ]);
      expect(out).toHaveLength(2);
      expect(out.find((e) => e.event_id === "dup")?.pathname).toBe("/first");
    });

    it("handles empty / undefined input", () => {
      expect(orderAndDedupeBuffer([])).toEqual([]);
      expect(orderAndDedupeBuffer(undefined as any)).toEqual([]);
    });
  });

  describe("parseBufferedEvent", () => {
    it("parses a valid serialized event", () => {
      const parsed = parseBufferedEvent(JSON.stringify(ev()));
      expect(parsed?.website_id).toBe("web_1");
    });
    it("returns null for malformed JSON", () => {
      expect(parseBufferedEvent("{not json")).toBeNull();
    });
    it("returns null when required identity fields are missing", () => {
      const { visitor_id, ...rest } = ev();
      expect(parseBufferedEvent(JSON.stringify(rest))).toBeNull();
    });
  });
});
