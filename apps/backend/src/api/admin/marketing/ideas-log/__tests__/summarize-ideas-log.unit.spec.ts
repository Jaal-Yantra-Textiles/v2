/**
 * Unit tests for the pure ideas-log read-route helpers (#659 slice 2, PR-5).
 * Run: TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules npx jest --testPathPattern=summarize-ideas-log
 */
import {
  parseBoolFilter,
  parseNonNegativeInt,
  sortIdeasLogNewestFirst,
  summarizeIdeasLog,
  type IdeasLogRowLike,
} from "../summarize-ideas-log"

describe("summarizeIdeasLog", () => {
  it("returns an all-zero summary for an empty / non-array input", () => {
    expect(summarizeIdeasLog([])).toEqual({
      total: 0,
      guard_passed: 0,
      guard_failed: 0,
      sent: 0,
      not_sent: 0,
      regenerated: 0,
    })
    // defensive: non-array
    expect(summarizeIdeasLog(undefined as any).total).toBe(0)
  })

  it("counts guard pass/fail, sent/not-sent and regenerated independently", () => {
    const rows: IdeasLogRowLike[] = [
      { guard_passed: true, sent: true, regenerated: false },
      { guard_passed: true, sent: false, regenerated: true },
      { guard_passed: false, sent: false, regenerated: false },
      { guard_passed: null, sent: null }, // null guard/sent => failed / not_sent
    ]
    expect(summarizeIdeasLog(rows)).toEqual({
      total: 4,
      guard_passed: 2,
      guard_failed: 2,
      sent: 1,
      not_sent: 3,
      regenerated: 1,
    })
  })

  it("treats only strict true as passed/sent (fail-closed on undefined)", () => {
    const rows: IdeasLogRowLike[] = [{}, { guard_passed: true, sent: true }]
    const s = summarizeIdeasLog(rows)
    expect(s.guard_passed).toBe(1)
    expect(s.guard_failed).toBe(1)
    expect(s.sent).toBe(1)
    expect(s.not_sent).toBe(1)
  })
})

describe("sortIdeasLogNewestFirst", () => {
  it("orders by generated_for_date descending and does not mutate input", () => {
    const rows: IdeasLogRowLike[] = [
      { id: "a", generated_for_date: "2026-06-20T00:00:00.000Z" },
      { id: "b", generated_for_date: "2026-06-23T00:00:00.000Z" },
      { id: "c", generated_for_date: "2026-06-21T00:00:00.000Z" },
    ]
    const sorted = sortIdeasLogNewestFirst(rows)
    expect(sorted.map((r) => r.id)).toEqual(["b", "c", "a"])
    // original untouched
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"])
  })

  it("accepts Date objects and pushes missing dates last", () => {
    const rows: IdeasLogRowLike[] = [
      { id: "none", generated_for_date: null },
      { id: "new", generated_for_date: new Date("2026-06-23T00:00:00.000Z") },
      { id: "old", generated_for_date: new Date("2026-06-01T00:00:00.000Z") },
    ]
    expect(sortIdeasLogNewestFirst(rows).map((r) => r.id)).toEqual([
      "new",
      "old",
      "none",
    ])
  })

  it("returns [] for non-array input", () => {
    expect(sortIdeasLogNewestFirst(undefined as any)).toEqual([])
  })
})

describe("parseNonNegativeInt", () => {
  it("parses valid non-negative integers", () => {
    expect(parseNonNegativeInt("0", 50)).toBe(0)
    expect(parseNonNegativeInt("25", 50)).toBe(25)
    expect(parseNonNegativeInt(10, 50)).toBe(10)
  })

  it("falls back on negatives, non-numerics and missing values", () => {
    expect(parseNonNegativeInt("-5", 50)).toBe(50)
    expect(parseNonNegativeInt("abc", 50)).toBe(50)
    expect(parseNonNegativeInt(undefined, 50)).toBe(50)
    expect(parseNonNegativeInt(null, 0)).toBe(0)
  })
})

describe("parseBoolFilter", () => {
  it("parses truthy/falsy strings and booleans", () => {
    expect(parseBoolFilter("true")).toBe(true)
    expect(parseBoolFilter("1")).toBe(true)
    expect(parseBoolFilter("FALSE")).toBe(false)
    expect(parseBoolFilter("0")).toBe(false)
    expect(parseBoolFilter(true)).toBe(true)
    expect(parseBoolFilter(false)).toBe(false)
  })

  it("returns undefined for absent / unrecognised values (filter not applied)", () => {
    expect(parseBoolFilter(undefined)).toBeUndefined()
    expect(parseBoolFilter("maybe")).toBeUndefined()
    expect(parseBoolFilter(["true"])).toBeUndefined()
  })
})
