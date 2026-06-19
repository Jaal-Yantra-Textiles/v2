import { createHmac } from "crypto";
import {
  filterAlreadyPersisted,
  normalizeAndDedupeBatch,
  verifyIngestAuth,
  type RawIngestEvent,
} from "../lib";

const SECRET = "test-ingest-secret";
const FALLBACK = new Date("2026-06-19T00:00:00.000Z");

const baseEvent = (over: Partial<RawIngestEvent> = {}): RawIngestEvent => ({
  website_id: "web_1",
  pathname: "/",
  visitor_id: "vis_1",
  session_id: "ses_1",
  ...over,
});

describe("verifyIngestAuth", () => {
  it("returns false when no secret is configured", () => {
    expect(
      verifyIngestAuth({ secret: undefined, sharedSecretHeader: SECRET })
    ).toBe(false);
  });

  it("accepts a matching shared secret (timing-safe)", () => {
    expect(
      verifyIngestAuth({ secret: SECRET, sharedSecretHeader: SECRET })
    ).toBe(true);
  });

  it("rejects a wrong shared secret", () => {
    expect(
      verifyIngestAuth({ secret: SECRET, sharedSecretHeader: "nope" })
    ).toBe(false);
  });

  it("rejects a shared secret of different length without throwing", () => {
    expect(
      verifyIngestAuth({ secret: SECRET, sharedSecretHeader: "x" })
    ).toBe(false);
  });

  it("accepts a valid HMAC signature over the raw body (sha256= prefix)", () => {
    const rawBody = JSON.stringify({ events: [baseEvent()] });
    const sig = createHmac("sha256", SECRET).update(rawBody).digest("hex");
    expect(
      verifyIngestAuth({
        secret: SECRET,
        signatureHeader: `sha256=${sig}`,
        rawBody,
      })
    ).toBe(true);
  });

  it("accepts a valid HMAC signature without the prefix", () => {
    const rawBody = "payload";
    const sig = createHmac("sha256", SECRET).update(rawBody).digest("hex");
    expect(
      verifyIngestAuth({ secret: SECRET, signatureHeader: sig, rawBody })
    ).toBe(true);
  });

  it("rejects a tampered HMAC body", () => {
    const rawBody = "payload";
    const sig = createHmac("sha256", SECRET).update(rawBody).digest("hex");
    expect(
      verifyIngestAuth({
        secret: SECRET,
        signatureHeader: `sha256=${sig}`,
        rawBody: "payload-tampered",
      })
    ).toBe(false);
  });

  it("rejects when neither scheme is supplied", () => {
    expect(verifyIngestAuth({ secret: SECRET })).toBe(false);
  });
});

describe("normalizeAndDedupeBatch", () => {
  it("drops events missing required fields and counts them", () => {
    const { normalized, invalid } = normalizeAndDedupeBatch(
      [
        baseEvent(),
        { pathname: "/x", visitor_id: "v", session_id: "s" }, // no website_id
        { website_id: "w", visitor_id: "v", session_id: "s" }, // no pathname
      ],
      FALLBACK
    );
    expect(normalized).toHaveLength(1);
    expect(invalid).toBe(2);
  });

  it("dedupes within batch on event_id keeping the first", () => {
    const { normalized, deduped } = normalizeAndDedupeBatch(
      [
        baseEvent({ event_id: "e1", pathname: "/first" }),
        baseEvent({ event_id: "e1", pathname: "/second" }),
        baseEvent({ event_id: "e2", pathname: "/third" }),
      ],
      FALLBACK
    );
    expect(deduped).toBe(1);
    const ids = normalized.map((e) => e.event_id);
    expect(ids).toEqual(expect.arrayContaining(["e1", "e2"]));
    expect(normalized.find((e) => e.event_id === "e1")?.pathname).toBe(
      "/first"
    );
  });

  it("keeps all events without an event_id (cannot dedupe)", () => {
    const { normalized, deduped } = normalizeAndDedupeBatch(
      [baseEvent({ pathname: "/a" }), baseEvent({ pathname: "/b" })],
      FALLBACK
    );
    expect(deduped).toBe(0);
    expect(normalized).toHaveLength(2);
  });

  it("sorts ascending by timestamp and accepts ts/timestamp/epoch", () => {
    const { normalized } = normalizeAndDedupeBatch(
      [
        baseEvent({ pathname: "/late", timestamp: "2026-06-19T10:00:00Z" }),
        baseEvent({ pathname: "/early", ts: "2026-06-19T08:00:00Z" }),
        baseEvent({
          pathname: "/mid",
          timestamp: Date.parse("2026-06-19T09:00:00Z"),
        }),
      ],
      FALLBACK
    );
    expect(normalized.map((e) => e.pathname)).toEqual([
      "/early",
      "/mid",
      "/late",
    ]);
  });

  it("uses the fallback timestamp when none is supplied", () => {
    const { normalized } = normalizeAndDedupeBatch([baseEvent()], FALLBACK);
    expect(normalized[0].timestamp.getTime()).toBe(FALLBACK.getTime());
  });

  it("normalizes defaults (event_type, is_404, nullable text)", () => {
    const { normalized } = normalizeAndDedupeBatch(
      [baseEvent({ event_type: "garbage" as any, referrer: "" })],
      FALLBACK
    );
    expect(normalized[0].event_type).toBe("pageview");
    expect(normalized[0].is_404).toBe(false);
    expect(normalized[0].referrer).toBeNull();
  });
});

describe("filterAlreadyPersisted", () => {
  it("skips events whose event_id is already persisted", () => {
    const { normalized } = normalizeAndDedupeBatch(
      [
        baseEvent({ event_id: "e1" }),
        baseEvent({ event_id: "e2" }),
        baseEvent({ pathname: "/no-id" }),
      ],
      FALLBACK
    );
    const { fresh, skipped } = filterAlreadyPersisted(normalized, ["e1"]);
    expect(skipped).toBe(1);
    expect(fresh.map((e) => e.event_id)).toEqual(
      expect.arrayContaining(["e2", null])
    );
    expect(fresh).toHaveLength(2);
  });

  it("keeps everything when nothing is persisted", () => {
    const { normalized } = normalizeAndDedupeBatch(
      [baseEvent({ event_id: "e1" })],
      FALLBACK
    );
    const { fresh, skipped } = filterAlreadyPersisted(normalized, []);
    expect(skipped).toBe(0);
    expect(fresh).toHaveLength(1);
  });
});
