import { orderAdvancePercent, orderBillableLimit } from "../payment-terms"

/**
 * #2315 — the one owner of "when may a supplier be paid". The dangerous
 * direction is an absent or garbled percent turning into "pay it all now", so
 * those cases are pinned to 0.
 */
describe("orderAdvancePercent", () => {
  it("is 0 for a pay-on-receipt order, whatever percent it carries", () => {
    expect(orderAdvancePercent({ payment_terms: "on_receipt", advance_percent: 100 })).toBe(0)
  })

  it("is 0 for an advance order with no percent — never a default of 100", () => {
    expect(orderAdvancePercent({ payment_terms: "advance" })).toBe(0)
    expect(orderAdvancePercent({ payment_terms: "advance", advance_percent: null })).toBe(0)
    expect(orderAdvancePercent({ payment_terms: "advance", advance_percent: "" })).toBe(0)
    expect(orderAdvancePercent({ payment_terms: "advance", advance_percent: "abc" })).toBe(0)
  })

  it("clamps to 0–100", () => {
    expect(orderAdvancePercent({ payment_terms: "advance", advance_percent: 150 })).toBe(100)
    expect(orderAdvancePercent({ payment_terms: "advance", advance_percent: -5 })).toBe(0)
    expect(orderAdvancePercent({ payment_terms: "advance", advance_percent: "30" })).toBe(30)
  })
})

describe("orderBillableLimit", () => {
  it("is the whole ceiling once anything is received", () => {
    expect(orderBillableLimit({ payment_terms: "on_receipt" }, 8095.2, 0.5)).toEqual({
      limit: 8095.2,
      basis: "received",
      advance_percent: 0,
    })
  })

  it("is 0 before receipt on a pay-on-receipt order", () => {
    expect(orderBillableLimit({}, 8095.2, 0)).toEqual({
      limit: 0,
      basis: "awaiting_receipt",
      advance_percent: 0,
    })
  })

  it("is the advance share before receipt, rounded to the paisa", () => {
    expect(
      orderBillableLimit({ payment_terms: "advance", advance_percent: 33 }, 8095.2, 0)
    ).toEqual({ limit: 2671.42, basis: "advance", advance_percent: 33 })
  })

  it("leaves a sample order at its ceiling — samples post no receipts", () => {
    expect(orderBillableLimit({ is_sample: true }, 1300, 0).limit).toBe(1300)
  })
})
