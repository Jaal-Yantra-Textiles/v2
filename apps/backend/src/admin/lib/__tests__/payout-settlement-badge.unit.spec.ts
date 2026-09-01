import { payoutSettlementBadge } from "../payment-submission-status"

/**
 * The real states the 2026-09-01 reconciliation produced on Prince Tailors.
 */
describe("payoutSettlementBadge (#1712)", () => {
  it("says 'settled' for a fully-settled payout still awaiting approval", () => {
    // The exact row that read a bare "Pending" above a footer saying "paid".
    expect(
      payoutSettlementBadge({ status: "Pending", amount: 3250, settled_amount: 3250 })
    ).toEqual({ label: "settled", color: "green" })
  })

  it("says 'part settled' when only some of the money has arrived", () => {
    // Parmar: 28,200 billed, 20,000 linked.
    expect(
      payoutSettlementBadge({ status: "Approved", amount: 28200, settled_amount: 20000 })
    ).toEqual({ label: "part settled", color: "blue" })
  })

  /** `Paid` already says the money arrived; a second badge is noise. */
  it("stays silent for a Paid payout", () => {
    expect(
      payoutSettlementBadge({ status: "Paid", amount: 1000, settled_amount: 1000 })
    ).toBeNull()
  })

  it("stays silent when nothing has been settled", () => {
    expect(
      payoutSettlementBadge({ status: "Pending", amount: 1250, settled_amount: 0 })
    ).toBeNull()
    expect(
      payoutSettlementBadge({ status: "Pending", amount: 1250 })
    ).toBeNull()
  })

  it("stays silent for a payout with no amount to compare against", () => {
    expect(
      payoutSettlementBadge({ status: "Pending", amount: 0, settled_amount: 500 })
    ).toBeNull()
  })

  /**
   * ⚠️ `settled_amount` is a rounded sum of payment rows while the payout total
   * is stored separately. An exact `>=` would call this "part settled".
   */
  it("treats a sub-cent rounding difference as fully settled", () => {
    expect(
      payoutSettlementBadge({ status: "Pending", amount: 3250, settled_amount: 3249.999 })
    ).toEqual({ label: "settled", color: "green" })
  })

  it("does not round away a real shortfall", () => {
    expect(
      payoutSettlementBadge({ status: "Pending", amount: 3250, settled_amount: 3249 })
    ).toEqual({ label: "part settled", color: "blue" })
  })

  it("survives non-numeric input rather than rendering NaN", () => {
    expect(
      payoutSettlementBadge({ status: "Pending", amount: null, settled_amount: null })
    ).toBeNull()
  })
})
