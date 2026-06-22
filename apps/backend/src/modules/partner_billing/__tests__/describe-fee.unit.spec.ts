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
      rate_label: "2.00%",
      fee_amount: 199.99,
      order_total: 9999.5,
      currency_code: "INR",
      is_collectible: true,
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
