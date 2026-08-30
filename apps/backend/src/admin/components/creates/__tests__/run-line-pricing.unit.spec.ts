import {
  runBillsVerbatimTotal,
  runLineAmount,
} from "../lib/run-line-pricing"

/**
 * #1596 / #1616 — the screen must bill what was agreed, and send it on a
 * channel that means what it says.
 *
 * These are the two shapes that cost real money: a total-priced run billed as
 * though its derived rate were a negotiated one, and a screen showing a figure
 * the server then writes differently.
 */
describe("runLineAmount", () => {
  const RUN_TOTAL = {
    // ₹10,000 agreed for the job, 9 ordered, 7 made. The offer bills the
    // produced figure, so its derived rate is 10000/7.
    quantity: 7,
    rate: 1428.57,
    amount: 10000,
    unit_is_derived: true,
  }

  it("bills a total-priced run its AGREED TOTAL, not quantity x derived rate", () => {
    // 7 x 1428.57 = 9,999.99 — the paisa this test exists to refuse.
    expect(runLineAmount({ ...RUN_TOTAL, hasTypedRate: false })).toBe(10000)
  })

  it("does not move a total-priced run's amount when the quantity changes", () => {
    // The total was for the job. Billing 9 units of a derived rate would pay
    // ₹12,857.13 for a ₹10,000 job; billing 4 would pay ₹5,714.28 for it.
    expect(
      runLineAmount({ ...RUN_TOTAL, quantity: 9, hasTypedRate: false })
    ).toBe(10000)
    expect(
      runLineAmount({ ...RUN_TOTAL, quantity: 4, hasTypedRate: false })
    ).toBe(10000)
  })

  it("multiplies once a human has TYPED a rate — that is a decision they made", () => {
    // The documented way out: a typed rate outranks the stored figure, and
    // from here the row is per-piece because someone said so.
    expect(
      runLineAmount({
        ...RUN_TOTAL,
        quantity: 7,
        rate: 1500,
        hasTypedRate: true,
      })
    ).toBe(10500)
  })

  it("multiplies a genuine per-unit run, where quantity IS the money", () => {
    expect(
      runLineAmount({
        quantity: 4,
        rate: 1200,
        amount: 4800,
        unit_is_derived: false,
        hasTypedRate: false,
      })
    ).toBe(4800)
  })

  it("moves with the quantity on a per-unit run", () => {
    expect(
      runLineAmount({
        quantity: 7,
        rate: 1200,
        amount: 4800,
        unit_is_derived: false,
        hasTypedRate: false,
      })
    ).toBe(8400)
  })

  it("bills nothing rather than NaN when a box is half-typed", () => {
    expect(
      runLineAmount({
        quantity: Number.NaN,
        rate: 1200,
        amount: 0,
        unit_is_derived: false,
        hasTypedRate: true,
      })
    ).toBe(0)
  })
})

describe("runBillsVerbatimTotal", () => {
  it("is true only while the derived rate is untouched", () => {
    expect(
      runBillsVerbatimTotal({ unit_is_derived: true, hasTypedRate: false })
    ).toBe(true)
    expect(
      runBillsVerbatimTotal({ unit_is_derived: true, hasTypedRate: true })
    ).toBe(false)
    expect(
      runBillsVerbatimTotal({ unit_is_derived: false, hasTypedRate: false })
    ).toBe(false)
  })

  it("treats a missing flag as NOT derived", () => {
    // Absence is not a claim. A row with no flag is priced the ordinary way
    // rather than silently pinned to whatever `amount` happened to hold.
    expect(
      runBillsVerbatimTotal({ unit_is_derived: undefined, hasTypedRate: false })
    ).toBe(false)
    expect(
      runBillsVerbatimTotal({ unit_is_derived: null, hasTypedRate: false })
    ).toBe(false)
  })
})
