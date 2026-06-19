/**
 * Unit test — computeFee / parsePlatformFeeBps (#336 Slice 0)
 *
 * Pure fee math for partner transaction-fee billing. No DI, no DB.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="compute-fee"
 */
import { computeFee, parsePlatformFeeBps } from "../lib/compute-fee"

describe("computeFee", () => {
  describe("percentage basis (rate = basis points)", () => {
    it("computes 2% (200 bps) of the order total", () => {
      expect(computeFee(10000, "percentage", 200)).toBe(200)
    })

    it("computes 2% of a fractional total, rounded to 2 decimals", () => {
      // 99.99 * 200 / 10000 = 1.9998 → 2.00
      expect(computeFee(99.99, "percentage", 200)).toBe(2)
    })

    it("computes a non-round percentage and rounds to 2 decimals", () => {
      // 1234.56 * 175 / 10000 = 21.6048 → 21.6
      expect(computeFee(1234.56, "percentage", 175)).toBe(21.6)
    })

    it("returns 0 when the rate is 0 bps", () => {
      expect(computeFee(10000, "percentage", 0)).toBe(0)
    })
  })

  describe("flat basis (rate = flat amount)", () => {
    it("returns the flat amount when below the order total", () => {
      expect(computeFee(10000, "flat", 50)).toBe(50)
    })

    it("caps the flat amount at the order total", () => {
      expect(computeFee(30, "flat", 50)).toBe(30)
    })
  })

  describe("defensive guards (never throws, returns 0)", () => {
    it.each([
      ["zero total", 0, "percentage", 200],
      ["negative total", -100, "percentage", 200],
      ["NaN total", NaN, "percentage", 200],
      ["Infinity total", Infinity, "percentage", 200],
      ["negative rate", 10000, "percentage", -5],
      ["NaN rate", 10000, "percentage", NaN],
    ])("returns 0 for %s", (_label, total, basis, rate) => {
      expect(computeFee(total as number, basis as any, rate as number)).toBe(0)
    })
  })
})

describe("parsePlatformFeeBps", () => {
  it("defaults to 200 (2%) when unset", () => {
    expect(parsePlatformFeeBps(undefined)).toBe(200)
    expect(parsePlatformFeeBps("")).toBe(200)
  })

  it("parses a valid bps env value", () => {
    expect(parsePlatformFeeBps("350")).toBe(350)
  })

  it("truncates a fractional bps value to an integer", () => {
    expect(parsePlatformFeeBps("250.9")).toBe(250)
  })

  it("falls back on invalid / negative input", () => {
    expect(parsePlatformFeeBps("abc")).toBe(200)
    expect(parsePlatformFeeBps("-10")).toBe(200)
    expect(parsePlatformFeeBps("nope", 500)).toBe(500)
  })
})
