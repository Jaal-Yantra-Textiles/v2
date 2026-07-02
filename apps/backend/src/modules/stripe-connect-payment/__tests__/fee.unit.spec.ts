import { PaymentSessionStatus } from "@medusajs/framework/utils"
import {
  currencyMultiplier,
  toStripeMinorUnits,
  parseFeePercent,
  computeApplicationFee,
  mapStripeStatus,
} from "../lib/fee"

describe("stripe-connect fee/amount lib (Half B)", () => {
  describe("currencyMultiplier", () => {
    it("is 100 for standard 2-decimal currencies", () => {
      expect(currencyMultiplier("eur")).toBe(100)
      expect(currencyMultiplier("USD")).toBe(100)
      expect(currencyMultiplier("inr")).toBe(100)
    })
    it("is 1 for zero-decimal currencies", () => {
      expect(currencyMultiplier("JPY")).toBe(1)
      expect(currencyMultiplier("krw")).toBe(1)
    })
    it("is 1000 for three-decimal currencies", () => {
      expect(currencyMultiplier("KWD")).toBe(1000)
    })
  })

  describe("toStripeMinorUnits", () => {
    it("converts EUR major → cents", () => {
      expect(toStripeMinorUnits(12.5, "eur")).toBe(1250)
      expect(toStripeMinorUnits("9.99", "EUR")).toBe(999)
    })
    it("passes zero-decimal currencies through", () => {
      expect(toStripeMinorUnits(1500, "JPY")).toBe(1500)
    })
    it("rounds three-decimal currencies to the nearest ten", () => {
      // 1.234 KWD → 1234 → ceil to 1240
      expect(toStripeMinorUnits(1.234, "KWD")).toBe(1240)
    })
    it("handles rounding without float drift", () => {
      expect(toStripeMinorUnits(19.99, "usd")).toBe(1999)
      expect(toStripeMinorUnits(0.1 + 0.2, "usd")).toBe(30)
    })
    it("returns 0 for non-finite input", () => {
      expect(toStripeMinorUnits("abc", "eur")).toBe(0)
    })
  })

  describe("parseFeePercent", () => {
    it("parses plan feature strings", () => {
      expect(parseFeePercent("2%")).toBeCloseTo(0.02)
      expect(parseFeePercent("4%")).toBeCloseTo(0.04)
      expect(parseFeePercent("1%")).toBeCloseTo(0.01)
      expect(parseFeePercent("2.5%")).toBeCloseTo(0.025)
    })
    it("parses bare numbers and numeric input", () => {
      expect(parseFeePercent("2")).toBeCloseTo(0.02)
      expect(parseFeePercent(3)).toBeCloseTo(0.03)
    })
    it("returns 0 for invalid / negative / missing", () => {
      expect(parseFeePercent(null)).toBe(0)
      expect(parseFeePercent(undefined)).toBe(0)
      expect(parseFeePercent("free")).toBe(0)
      expect(parseFeePercent("-1%")).toBe(0)
    })
  })

  describe("computeApplicationFee", () => {
    it("computes fee in minor units", () => {
      // €50.00 = 5000 cents, 2% → 100 cents
      expect(computeApplicationFee(5000, 0.02)).toBe(100)
      // 4% of 999 → 39.96 → 40
      expect(computeApplicationFee(999, 0.04)).toBe(40)
    })
    it("is 0 when amount or percent is non-positive", () => {
      expect(computeApplicationFee(0, 0.02)).toBe(0)
      expect(computeApplicationFee(5000, 0)).toBe(0)
      expect(computeApplicationFee(-100, 0.02)).toBe(0)
    })
    it("never exceeds the charge", () => {
      expect(computeApplicationFee(100, 2)).toBe(100)
    })
  })

  describe("mapStripeStatus", () => {
    it("maps the capture lifecycle", () => {
      expect(mapStripeStatus("requires_capture")).toBe(
        PaymentSessionStatus.AUTHORIZED
      )
      expect(mapStripeStatus("succeeded")).toBe(PaymentSessionStatus.CAPTURED)
      expect(mapStripeStatus("canceled")).toBe(PaymentSessionStatus.CANCELED)
      expect(mapStripeStatus("requires_action")).toBe(
        PaymentSessionStatus.REQUIRES_MORE
      )
      expect(mapStripeStatus("processing")).toBe(PaymentSessionStatus.PENDING)
    })
    it("disambiguates requires_payment_method by last_payment_error", () => {
      expect(mapStripeStatus("requires_payment_method", false)).toBe(
        PaymentSessionStatus.PENDING
      )
      expect(mapStripeStatus("requires_payment_method", true)).toBe(
        PaymentSessionStatus.ERROR
      )
    })
    it("defaults unknown statuses to pending", () => {
      expect(mapStripeStatus("something_new")).toBe(PaymentSessionStatus.PENDING)
    })
  })
})
