/**
 * Unit test — summarizePartnerFees (#336 Slice 4)
 *
 * Pure roll-up math for the partner-fee read API. No DI, no DB.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="summarize-fees"
 */
import { summarizePartnerFees } from "../summarize-fees"

describe("summarizePartnerFees", () => {
  it("returns zeroed totals for an empty / nullish input", () => {
    for (const input of [[], null, undefined] as const) {
      expect(summarizePartnerFees(input)).toEqual({
        count: 0,
        total_fee_amount: 0,
        net_fee_amount: 0,
        by_status: {},
        by_currency: {},
      })
    }
  })

  it("sums total and net, excluding reversed/waived from net", () => {
    const s = summarizePartnerFees([
      { status: "accrued", fee_amount: 200, currency_code: "INR" },
      { status: "invoiced", fee_amount: 50, currency_code: "INR" },
      { status: "reversed", fee_amount: 100, currency_code: "INR" },
      { status: "waived", fee_amount: 25, currency_code: "INR" },
    ])
    expect(s.count).toBe(4)
    expect(s.total_fee_amount).toBe(375) // 200+50+100+25
    expect(s.net_fee_amount).toBe(250) // accrued + invoiced only
  })

  it("buckets by status with per-status counts and amounts", () => {
    const s = summarizePartnerFees([
      { status: "accrued", fee_amount: 10, currency_code: "INR" },
      { status: "accrued", fee_amount: 5, currency_code: "INR" },
      { status: "reversed", fee_amount: 3, currency_code: "INR" },
    ])
    expect(s.by_status.accrued).toEqual({ count: 2, fee_amount: 15 })
    expect(s.by_status.reversed).toEqual({ count: 1, fee_amount: 3 })
  })

  it("buckets by lower-cased currency with total vs net per currency", () => {
    const s = summarizePartnerFees([
      { status: "accrued", fee_amount: 100, currency_code: "INR" },
      { status: "reversed", fee_amount: 40, currency_code: "inr" },
      { status: "accrued", fee_amount: 9, currency_code: "EUR" },
    ])
    expect(s.by_currency.inr).toEqual({
      count: 2,
      total_amount: 140,
      net_amount: 100,
    })
    expect(s.by_currency.eur).toEqual({
      count: 1,
      total_amount: 9,
      net_amount: 9,
    })
  })

  it("coerces bigNumber string amounts and tolerates malformed rows", () => {
    const s = summarizePartnerFees([
      { status: "accrued", fee_amount: "12.5", currency_code: "INR" },
      { status: "accrued", fee_amount: null, currency_code: "INR" },
      { status: "accrued", fee_amount: "not-a-number", currency_code: "INR" },
      // missing status → defaults to accrued; missing currency → "unknown"
      { fee_amount: 7.5 },
    ])
    expect(s.total_fee_amount).toBe(20) // 12.5 + 0 + 0 + 7.5
    expect(s.net_fee_amount).toBe(20)
    expect(s.by_currency.unknown.count).toBe(1)
    expect(s.by_status.accrued.count).toBe(4)
  })

  it("rounds accumulated floating amounts to 2 decimals", () => {
    const s = summarizePartnerFees([
      { status: "accrued", fee_amount: 0.1, currency_code: "INR" },
      { status: "accrued", fee_amount: 0.2, currency_code: "INR" },
    ])
    expect(s.by_currency.inr.total_amount).toBe(0.3)
    expect(s.total_fee_amount).toBe(0.3)
  })
})
