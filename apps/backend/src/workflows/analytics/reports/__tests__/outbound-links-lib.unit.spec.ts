import {
  computeOutboundLinks,
  extractHref,
  DEFAULT_OUTBOUND_LINKS_LIMIT,
  MAX_OUTBOUND_LINKS_LIMIT,
  type OutboundLinkEventRow,
} from "../outbound-links-lib";

describe("outbound-links-lib (#569 S5a)", () => {
  describe("extractHref", () => {
    it("returns the href string from metadata", () => {
      expect(extractHref({ href: "https://x.com/" })).toBe("https://x.com/");
    });

    it("coerces non-string href to string", () => {
      expect(extractHref({ href: 123 })).toBe("123");
    });

    it("folds null/undefined/empty metadata into (none)", () => {
      expect(extractHref(null)).toBe("(none)");
      expect(extractHref(undefined)).toBe("(none)");
      expect(extractHref("not-an-object")).toBe("(none)");
    });

    it("folds missing/null/empty href into (none)", () => {
      expect(extractHref({})).toBe("(none)");
      expect(extractHref({ href: null })).toBe("(none)");
      expect(extractHref({ href: "" })).toBe("(none)");
    });
  });

  describe("computeOutboundLinks", () => {
    const events: OutboundLinkEventRow[] = [
      { visitor_id: "v1", metadata: { href: "https://a.com/" } },
      { visitor_id: "v2", metadata: { href: "https://a.com/" } },
      { visitor_id: "v1", metadata: { href: "https://a.com/" } },
      { visitor_id: "v3", metadata: { href: "https://b.com/" } },
      { visitor_id: "v4", metadata: null },
    ];

    it("groups by href with counts, unique visitors, and percentage", () => {
      const res = computeOutboundLinks(events);
      expect(res.total_events).toBe(5);
      // v1,v2,v3,v4 distinct => 4 (v1 appears twice)
      expect(res.total_unique_visitors).toBe(4);

      const top = res.results[0];
      expect(top.value).toBe("https://a.com/");
      expect(top.count).toBe(3);
      expect(top.unique_visitors).toBe(2); // v1 + v2
      expect(top.percentage).toBe(60); // 3/5
    });

    it("folds events without a usable href into (none)", () => {
      const res = computeOutboundLinks(events);
      const none = res.results.find((r) => r.value === "(none)");
      expect(none).toBeDefined();
      expect(none!.count).toBe(1);
    });

    it("sorts by count desc then value asc", () => {
      const res = computeOutboundLinks([
        { visitor_id: "v1", metadata: { href: "https://z.com/" } },
        { visitor_id: "v2", metadata: { href: "https://a.com/" } },
        { visitor_id: "v3", metadata: { href: "https://a.com/" } },
      ]);
      expect(res.results.map((r) => r.value)).toEqual([
        "https://a.com/",
        "https://z.com/",
      ]);
    });

    it("returns zeroed result for empty/nullish input", () => {
      for (const input of [[], null, undefined] as any[]) {
        const res = computeOutboundLinks(input);
        expect(res.total_events).toBe(0);
        expect(res.total_unique_visitors).toBe(0);
        expect(res.results).toEqual([]);
      }
    });

    it("counts events with no visitor_id toward total but not unique", () => {
      const res = computeOutboundLinks([
        { metadata: { href: "https://a.com/" } },
        { metadata: { href: "https://a.com/" } },
      ]);
      expect(res.total_events).toBe(2);
      expect(res.total_unique_visitors).toBe(0);
      expect(res.results[0].unique_visitors).toBe(0);
      expect(res.results[0].count).toBe(2);
    });

    it("respects an explicit limit", () => {
      const many: OutboundLinkEventRow[] = Array.from({ length: 5 }, (_, i) => ({
        visitor_id: `v${i}`,
        metadata: { href: `https://site-${i}.com/` },
      }));
      const res = computeOutboundLinks(many, 2);
      expect(res.results).toHaveLength(2);
      expect(res.total_events).toBe(5);
    });

    it("treats limit 0 as the default (falsy) and clamps negatives to 1", () => {
      const many: OutboundLinkEventRow[] = Array.from({ length: 3 }, (_, i) => ({
        visitor_id: `v${i}`,
        metadata: { href: `https://site-${i}.com/` },
      }));
      // 0 is falsy -> falls back to DEFAULT (mirrors session-pages-lib)
      expect(computeOutboundLinks(many, 0).results).toHaveLength(3);
      // negative is truthy -> clamped up to 1
      expect(computeOutboundLinks(many, -5).results).toHaveLength(1);
    });

    it("clamps limit above the max down to the max", () => {
      const res = computeOutboundLinks(
        [{ visitor_id: "v1", metadata: { href: "https://a.com/" } }],
        MAX_OUTBOUND_LINKS_LIMIT + 50
      );
      // only one bucket, but the cap must not exceed the max
      expect(res.results.length).toBeLessThanOrEqual(MAX_OUTBOUND_LINKS_LIMIT);
    });

    it("defaults the limit when given a non-finite value", () => {
      expect(DEFAULT_OUTBOUND_LINKS_LIMIT).toBe(20);
      const many: OutboundLinkEventRow[] = Array.from({ length: 25 }, (_, i) => ({
        visitor_id: `v${i}`,
        metadata: { href: `https://site-${String(i).padStart(2, "0")}.com/` },
      }));
      const res = computeOutboundLinks(many, NaN);
      expect(res.results).toHaveLength(DEFAULT_OUTBOUND_LINKS_LIMIT);
    });
  });
});
