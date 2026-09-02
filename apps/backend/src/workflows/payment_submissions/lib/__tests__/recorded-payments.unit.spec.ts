import { sumRecordedPayments } from "../payable-inventory-orders"

/**
 * "Have we already paid for this order?" (#1710)
 *
 * 🔴 The billable ceiling asks how much of an order has been BILLED. It has no
 * term for `internal_payments` at all, so an order paid in full and never
 * billed is offered as freshly payable. That is live on prod:
 *
 *   inv_order_01KKB850WN…  ordered 9,800 · receipts 5,800 · claimed 0
 *                          · RECORDED 9,800 (paid March 2026)
 *
 * …and `payable-inventory-orders` offered 5,800 of it, on a screen a partner
 * can now reach. This is the number that makes the row say so.
 */
describe("sumRecordedPayments", () => {
  it("sums the payments recorded against an order", () => {
    // The other prod order: two Completed INR 10,000 rows.
    expect(
      sumRecordedPayments([
        { id: "p1", amount: 10000, status: "Completed" },
        { id: "p2", amount: 10000, status: "Completed" },
      ])
    ).toBe(20000)
  })

  it("counts a Pending payment — that is what the partner portal writes", () => {
    /**
     * 🔑 Over-warning costs a glance. Under-warning is the double-pay this
     * exists to prevent, so the doubt resolves toward saying something.
     */
    expect(sumRecordedPayments([{ amount: 9800, status: "Pending" }])).toBe(9800)
  })

  it("ignores money that never moved", () => {
    expect(
      sumRecordedPayments([
        { amount: 5000, status: "Failed" },
        { amount: 5000, status: "Cancelled" },
        { amount: 1000, status: "Completed" },
      ])
    ).toBe(1000)
  })

  it("survives the to-many arriving as a bare object", () => {
    // ⚠️ `query.graph` returns a single-row to-many as an object, not an array.
    // Treating that as an array reads `undefined` and warns about nothing.
    expect(sumRecordedPayments({ amount: 9800, status: "Completed" })).toBe(9800)
  })

  it("is zero for an order with no payments at all", () => {
    expect(sumRecordedPayments(null)).toBe(0)
    expect(sumRecordedPayments([])).toBe(0)
    expect(sumRecordedPayments(undefined)).toBe(0)
  })

  it("does not let a junk amount poison the sum", () => {
    // `Number(undefined)` is NaN, and one NaN turns the whole total into NaN —
    // which renders as "NaN already paid" and warns about nothing legible.
    expect(
      sumRecordedPayments([
        { amount: "not a number", status: "Completed" },
        { amount: 500, status: "Completed" },
      ])
    ).toBe(500)
  })

  it("keeps a fractional receipt intact rather than rounding it away", () => {
    // #1613: an integer column rounded 11.8 to 12 and cost INR 646.50 across
    // seven rows. Money keeps two decimals here.
    expect(
      sumRecordedPayments([
        { amount: 10.5, status: "Completed" },
        { amount: 0.25, status: "Completed" },
      ])
    ).toBe(10.75)
  })
})
