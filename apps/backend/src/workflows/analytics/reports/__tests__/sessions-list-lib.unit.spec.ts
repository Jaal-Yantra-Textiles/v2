import {
  DEFAULT_SESSION_LIMIT,
  MAX_SESSION_LIMIT,
  SESSION_ORDER_FIELDS,
  SESSION_SELECT,
  isSessionOrderField,
  resolveLimit,
  resolveOffset,
  resolveOrderDir,
  resolveSessionListParams,
} from "../sessions-list-lib";

describe("sessions-list-lib", () => {
  describe("resolveLimit", () => {
    it("defaults when missing / non-numeric", () => {
      expect(resolveLimit(undefined)).toBe(DEFAULT_SESSION_LIMIT);
      expect(resolveLimit("abc")).toBe(DEFAULT_SESSION_LIMIT);
      expect(resolveLimit(null)).toBe(DEFAULT_SESSION_LIMIT);
    });

    it("defaults on zero / negatives", () => {
      expect(resolveLimit(0)).toBe(DEFAULT_SESSION_LIMIT);
      expect(resolveLimit(-5)).toBe(DEFAULT_SESSION_LIMIT);
    });

    it("caps at MAX_SESSION_LIMIT", () => {
      expect(resolveLimit(500)).toBe(MAX_SESSION_LIMIT);
      expect(resolveLimit("1000")).toBe(MAX_SESSION_LIMIT);
    });

    it("passes valid values through and floors", () => {
      expect(resolveLimit(25)).toBe(25);
      expect(resolveLimit("50")).toBe(50);
      expect(resolveLimit(33.9)).toBe(33);
    });
  });

  describe("resolveOffset", () => {
    it("defaults to 0 when missing / invalid / negative", () => {
      expect(resolveOffset(undefined)).toBe(0);
      expect(resolveOffset("abc")).toBe(0);
      expect(resolveOffset(-10)).toBe(0);
    });

    it("passes positive values through and floors", () => {
      expect(resolveOffset(40)).toBe(40);
      expect(resolveOffset("100")).toBe(100);
      expect(resolveOffset(20.7)).toBe(20);
    });
  });

  describe("resolveOrderDir", () => {
    it("defaults to DESC", () => {
      expect(resolveOrderDir(undefined)).toBe("DESC");
      expect(resolveOrderDir("nope")).toBe("DESC");
      expect(resolveOrderDir("desc")).toBe("DESC");
    });

    it("recognises ASC case-insensitively", () => {
      expect(resolveOrderDir("ASC")).toBe("ASC");
      expect(resolveOrderDir("asc")).toBe("ASC");
    });
  });

  describe("isSessionOrderField", () => {
    it("accepts whitelisted fields only", () => {
      for (const f of SESSION_ORDER_FIELDS) {
        expect(isSessionOrderField(f)).toBe(true);
      }
      expect(isSessionOrderField("website_id")).toBe(false);
      expect(isSessionOrderField("")).toBe(false);
      expect(isSessionOrderField(undefined)).toBe(false);
    });
  });

  describe("resolveSessionListParams", () => {
    it("returns safe defaults for an empty input", () => {
      expect(resolveSessionListParams()).toEqual({
        take: DEFAULT_SESSION_LIMIT,
        skip: 0,
        order: { started_at: "DESC" },
      });
    });

    it("clamps take/skip and whitelists order field + dir", () => {
      expect(
        resolveSessionListParams({
          limit: 999,
          offset: 60,
          order_by: "duration_seconds",
          order_dir: "asc",
        })
      ).toEqual({
        take: MAX_SESSION_LIMIT,
        skip: 60,
        order: { duration_seconds: "ASC" },
      });
    });

    it("falls back to started_at for an unknown order_by", () => {
      const { order } = resolveSessionListParams({ order_by: "evil; DROP" });
      expect(order).toEqual({ started_at: "DESC" });
    });

    it("never selects sensitive/internal columns", () => {
      // sanity: the projection only exposes session summary fields
      expect(SESSION_SELECT).toContain("session_id");
      expect(SESSION_SELECT).toContain("started_at");
      expect(SESSION_SELECT).not.toContain("website_id");
    });
  });
});
