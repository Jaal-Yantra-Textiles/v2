import { describeFee, formatFeeRate } from "../describe-fee"

describe("formatFeeRate (#623)", () => {
  it("renders percentage basis points as a percent (2 dp)", () => {
    expect(formatFeeRate("percentage", 200)).toBe("2.00%")
    expect(formatFeeRate("percentage", 250)).toBe("2.50%")
    expect(formatFeeRate("percentage", 0)).toBe("0.00%")
    expect(formatFeeRate("percentage", "175")).toBe("1.75%")
  })

  it("renders a flat fee as an amount + currency", () => {
    expect(formatFeeRate("flat", 50, "inr")).toBe("50.00 INR")
    expect(formatFeeRate("flat", "12.5", "usd")).toBe("12.50 USD")
  })

  it("coerces non-finite rates to 0", () => {
    expect(formatFeeRate("percentage", null)).toBe("0.00%")
    expect(formatFeeRate("percentage", undefined)).toBe("0.00%")
    expect(formatFeeRate("percentage", "nope")).toBe("0.00%")
  })
})

describe("describeFee (#623)", () => {
  it("returns null for nullish / order-less rows", () => {
    expect(describeFee(null)).toBeNull()
    expect(describeFee(undefined)).toBeNull()
    expect(describeFee({})).toBeNull()
    expect(describeFee({ fee_amount: 100 })).toBeNull()
  })

  it("shapes a percentage fee into a display object", () => {
    expect(
      describeFee({
        order_id: "order_1",
        currency_code: "inr",
        fee_basis: "percentage",
        fee_rate: 200,
        fee_amount: "199.99",
        order_total: "9999.50",
        status: "accrued",
      })
    ).toEqual({
      order_id: "order_1",
      status: "accrued",
      fee_basis: "percentage",
      fee_type: "commission",
      rate_label: "2.00%",
      fee_amount: 199.99,
      order_total: 9999.5,
      currency_code: "INR",
      is_collectible: true,
      breakdown: null,
      shipping: null,
      net_payout: 9799.51,
    })
  })

  describe("platform shipping + net payout", () => {
    const base = {
      order_id: "o",
      currency_code: "inr",
      fee_rate: 200,
      fee_amount: 100,
      order_total: 1000,
      status: "accrued",
    }

    it("reports no shipping when the partner shipped on their own account", () => {
      const d = describeFee(base)!
      expect(d.shipping).toBeNull()
      expect(d.net_payout).toBe(900)
    })

    it("deducts a recorded platform shipping charge from the payout", () => {
      const d = describeFee({
        ...base,
        shipping_amount: "75.5",
        shipping_currency_code: "inr",
        shipping_carrier: "shiprocket",
      })!
      expect(d.shipping).toEqual({
        amount: 75.5,
        currency_code: "INR",
        carrier: "shiprocket",
        is_foreign_currency: false,
      })
      expect(d.net_payout).toBe(824.5)
    })

    it("keeps a recorded zero rate as a shipping row rather than dropping it", () => {
      // Free shipping is a real carrier outcome and must stay visible; only an
      // ABSENT amount means "didn't use our shipping".
      const d = describeFee({ ...base, shipping_amount: 0 })!
      expect(d.shipping).not.toBeNull()
      expect(d.shipping!.amount).toBe(0)
      expect(d.net_payout).toBe(900)
    })

    it("surfaces but does not subtract a foreign-currency carrier charge", () => {
      // Subtracting it would mean inventing an FX rate; the UI shows it on its
      // own line in its own currency instead.
      const d = describeFee({
        ...base,
        shipping_amount: 12,
        shipping_currency_code: "usd",
        shipping_carrier: "shiprocket",
      })!
      expect(d.shipping!.is_foreign_currency).toBe(true)
      expect(d.shipping!.currency_code).toBe("USD")
      expect(d.net_payout).toBe(900)
    })

    it("does not deduct a waived or reversed commission", () => {
      expect(describeFee({ ...base, status: "waived" })!.net_payout).toBe(1000)
      expect(describeFee({ ...base, status: "reversed" })!.net_payout).toBe(1000)
    })

    it("still deducts shipping when the commission itself was waived", () => {
      // The carrier was paid regardless of whether we waived our cut.
      const d = describeFee({
        ...base,
        status: "waived",
        shipping_amount: 60,
        shipping_currency_code: "inr",
      })!
      expect(d.net_payout).toBe(940)
    })

    it("falls back to the order currency when the carrier currency is absent", () => {
      const d = describeFee({ ...base, shipping_amount: 40 })!
      expect(d.shipping!.currency_code).toBe("INR")
      expect(d.shipping!.is_foreign_currency).toBe(false)
      expect(d.net_payout).toBe(860)
    })
  })

  it("defaults basis to percentage and status to accrued", () => {
    const d = describeFee({ order_id: "o", fee_rate: 200 })!
    expect(d.fee_basis).toBe("percentage")
    expect(d.status).toBe("accrued")
    expect(d.currency_code).toBe("")
  })

  it("marks reversed / waived fees as not collectible", () => {
    expect(describeFee({ order_id: "o", status: "reversed" })!.is_collectible).toBe(false)
    expect(describeFee({ order_id: "o", status: "waived" })!.is_collectible).toBe(false)
    expect(describeFee({ order_id: "o", status: "invoiced" })!.is_collectible).toBe(true)
  })

  it("handles a flat fee", () => {
    const d = describeFee({
      order_id: "o",
      fee_basis: "flat",
      fee_rate: 50,
      fee_amount: 50,
      currency_code: "INR",
    })!
    expect(d.rate_label).toBe("50.00 INR")
    expect(d.fee_basis).toBe("flat")
  })
})
