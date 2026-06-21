import {
  computeSessionPageBreakdown,
  isSessionPageDimension,
  normalizePageValue,
  SESSION_PAGE_DIMENSIONS,
  DEFAULT_SESSION_PAGE_LIMIT,
  MAX_SESSION_PAGE_LIMIT,
  type SessionPageRow,
} from "../session-pages-lib";

describe("session-pages-lib (#569 S2)", () => {
  describe("isSessionPageDimension", () => {
    it("accepts the two supported dimensions", () => {
      expect(isSessionPageDimension("entry_page")).toBe(true);
      expect(isSessionPageDimension("exit_page")).toBe(true);
      expect(SESSION_PAGE_DIMENSIONS).toEqual(["entry_page", "exit_page"]);
    });

    it("rejects anything else", () => {
      expect(isSessionPageDimension("pathname")).toBe(false);
      expect(isSessionPageDimension("")).toBe(false);
      expect(isSessionPageDimension(undefined)).toBe(false);
      expect(isSessionPageDimension(null)).toBe(false);
      expect(isSessionPageDimension(42)).toBe(false);
    });
  });

  describe("normalizePageValue", () => {
    it("maps null/undefined/empty to the (none) label", () => {
      expect(normalizePageValue(null)).toBe("(none)");
      expect(normalizePageValue(undefined)).toBe("(none)");
      expect(normalizePageValue("")).toBe("(none)");
    });

    it("stringifies real values verbatim", () => {
      expect(normalizePageValue("/")).toBe("/");
      expect(normalizePageValue("/pricing")).toBe("/pricing");
    });
  });

  describe("computeSessionPageBreakdown", () => {
    it("returns a zeroed envelope for empty / nullish input", () => {
      const expected = {
        dimension: "entry_page",
        total_sessions: 0,
        total_unique_visitors: 0,
        results: [],
      };
      expect(computeSessionPageBreakdown([], "entry_page")).toEqual(expected);
      expect(computeSessionPageBreakdown(null, "entry_page")).toEqual(expected);
      expect(computeSessionPageBreakdown(undefined, "entry_page")).toEqual(expected);
    });

    it("groups sessions by entry_page with counts + percentages", () => {
      const sessions: SessionPageRow[] = [
        { entry_page: "/", visitor_id: "v1" },
        { entry_page: "/", visitor_id: "v2" },
        { entry_page: "/pricing", visitor_id: "v3" },
        { entry_page: "/", visitor_id: "v1" }, // repeat visitor in same bucket
      ];
      const result = computeSessionPageBreakdown(sessions, "entry_page");

      expect(result.dimension).toBe("entry_page");
      expect(result.total_sessions).toBe(4);
      expect(result.total_unique_visitors).toBe(3); // v1, v2, v3

      expect(result.results[0]).toEqual({
        value: "/",
        count: 3,
        unique_visitors: 2, // v1, v2
        percentage: 75, // 3/4
      });
      expect(result.results[1]).toEqual({
        value: "/pricing",
        count: 1,
        unique_visitors: 1,
        percentage: 25,
      });
    });

    it("groups by exit_page and folds null exits into (none)", () => {
      const sessions: SessionPageRow[] = [
        { exit_page: "/checkout", visitor_id: "v1" },
        { exit_page: null, visitor_id: "v2" },
        { exit_page: "", visitor_id: "v3" },
      ];
      const result = computeSessionPageBreakdown(sessions, "exit_page");

      expect(result.dimension).toBe("exit_page");
      expect(result.total_sessions).toBe(3);
      // two null/empty exits collapse into one (none) bucket
      const none = result.results.find((r) => r.value === "(none)");
      expect(none?.count).toBe(2);
      const checkout = result.results.find((r) => r.value === "/checkout");
      expect(checkout?.count).toBe(1);
    });

    it("sorts by count desc then value asc", () => {
      const sessions: SessionPageRow[] = [
        { entry_page: "/b" },
        { entry_page: "/a" },
        { entry_page: "/a" },
        { entry_page: "/c" },
        { entry_page: "/c" },
      ];
      const result = computeSessionPageBreakdown(sessions, "entry_page");
      // /a and /c both have count 2 -> /a first (value asc); /b count 1 last
      expect(result.results.map((r) => r.value)).toEqual(["/a", "/c", "/b"]);
    });

    it("caps the number of buckets to the (clamped) limit", () => {
      const sessions: SessionPageRow[] = Array.from({ length: 30 }, (_, i) => ({
        entry_page: `/p${i}`,
      }));
      expect(computeSessionPageBreakdown(sessions, "entry_page", 5).results).toHaveLength(5);
      // 0 / NaN fall back to default
      expect(
        computeSessionPageBreakdown(sessions, "entry_page", 0).results
      ).toHaveLength(Math.min(30, DEFAULT_SESSION_PAGE_LIMIT));
      // over-max clamps to MAX (more than we have here -> all 30)
      expect(
        computeSessionPageBreakdown(sessions, "entry_page", 9999).results.length
      ).toBeLessThanOrEqual(MAX_SESSION_PAGE_LIMIT);
    });

    it("counts sessions without a visitor_id but excludes them from unique_visitors", () => {
      const sessions: SessionPageRow[] = [
        { entry_page: "/", visitor_id: undefined },
        { entry_page: "/", visitor_id: null },
      ];
      const result = computeSessionPageBreakdown(sessions, "entry_page");
      expect(result.total_sessions).toBe(2);
      expect(result.total_unique_visitors).toBe(0);
      expect(result.results[0].count).toBe(2);
      expect(result.results[0].unique_visitors).toBe(0);
    });
  });
});
