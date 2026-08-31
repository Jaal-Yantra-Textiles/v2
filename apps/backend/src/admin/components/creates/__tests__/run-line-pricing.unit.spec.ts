import {
  runBillsVerbatimTotal,
  runLineAmount,
  runNeedsTypedPrice,
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

/**
 * #1596/#1676 — the REMAINDER of a partly-billed run.
 *
 * The admin screen used to drop a run the moment anything claimed it, so
 * "bill the rest of this job" was not a state that could exist here. Now that
 * the remainder is offered, an untouched total-priced row has two wrong
 * answers available and both cost money:
 *
 *   - re-bill the agreed total  ⇒ ₹10,000 agreed, ₹20,000 paid. `assessRunClaims`
 *     does NOT stop it: that guard bounds UNITS (4 + 5 ≤ 9), not money.
 *   - multiply the derived rate ⇒ the ₹7,777.77-on-₹10,000 re-pricing of #1679.
 *
 * So it bills NOTHING and says so, and the screen's zero-amount guard refuses
 * the submit until an operator states what the rest is worth.
 */
describe("a partly-billed run's remainder (#1676)", () => {
  const totalPriced = {
    quantity: 5,
    rate: 1111.11,
    amount: 10000,
    unit_is_derived: true,
  }

  it("bills NOTHING for an untouched total-priced remainder", () => {
    expect(
      runLineAmount({
        ...totalPriced,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).toBe(0)
  })

  it("does not re-bill the agreed total", () => {
    // The failure this exists to prevent, stated as its own case.
    expect(
      runLineAmount({
        ...totalPriced,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).not.toBe(10000)
  })

  it("does not multiply the derived rate either", () => {
    // 5 x 1111.11 = 5555.55 — a re-pricing nobody decided.
    expect(
      runLineAmount({
        ...totalPriced,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).not.toBe(5555.55)
  })

  it("prices from the moment a rate is typed", () => {
    expect(
      runLineAmount({
        ...totalPriced,
        rate: 1400,
        hasTypedRate: true,
        alreadyPartlyBilled: true,
      })
    ).toBe(7000)
  })

  it("leaves a PER-UNIT run alone — its rate was agreed, so it multiplies", () => {
    expect(
      runLineAmount({
        quantity: 9,
        rate: 1200,
        amount: 12000,
        unit_is_derived: false,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).toBe(10800)
  })

  it("leaves a FIRST claim on a total-priced run alone", () => {
    // Nothing has been billed, so the agreed total still stands verbatim.
    expect(
      runLineAmount({
        ...totalPriced,
        hasTypedRate: false,
        alreadyPartlyBilled: false,
      })
    ).toBe(10000)
  })

  it("stops the line-total CHANNEL from carrying a figure it no longer has", () => {
    // `hasVerbatimTotal` decides which request field the money is sent on.
    // A partly-billed total has no figure of its own, so it must not be sent
    // as a line total either.
    expect(
      runBillsVerbatimTotal({
        unit_is_derived: true,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).toBe(false)
    expect(
      runNeedsTypedPrice({
        unit_is_derived: true,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).toBe(true)
  })

  it("needs no typed price once one is typed, or when nothing was claimed", () => {
    expect(
      runNeedsTypedPrice({
        unit_is_derived: true,
        hasTypedRate: true,
        alreadyPartlyBilled: true,
      })
    ).toBe(false)
    expect(
      runNeedsTypedPrice({
        unit_is_derived: true,
        hasTypedRate: false,
        alreadyPartlyBilled: false,
      })
    ).toBe(false)
  })
})
