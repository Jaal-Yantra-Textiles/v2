import { foldPartnerCredits } from "../fold-credits"

describe("foldPartnerCredits (#1712)", () => {
  it("totals only Open credits", () => {
    // hrhandloom's real case: 1,380 open, plus one already consumed.
    const folded = foldPartnerCredits([
      { id: "c1", amount: 1380, status: "Open", currency_code: "inr" },
      { id: "c2", amount: 5000, status: "Applied", currency_code: "inr" },
    ])
    expect(folded.open_total).toBe(1380)
    expect(folded.count).toBe(2)
    expect(folded.currency).toBe("inr")
  })

  /** An Applied credit already reduced a payout; counting it offers it twice. */
  it("excludes Applied and Cancelled", () => {
    expect(
      foldPartnerCredits([
        { amount: 100, status: "Applied" },
        { amount: 200, status: "Cancelled" },
      ]).open_total
    ).toBe(0)
  })

  it("handles an empty or missing list", () => {
    expect(foldPartnerCredits([]).open_total).toBe(0)
    expect(foldPartnerCredits(null).count).toBe(0)
    expect(foldPartnerCredits(undefined).currency).toBeNull()
  })

  /** `amount` arrives as a string from a numeric column often enough. */
  it("coerces string amounts", () => {
    expect(
      foldPartnerCredits([{ amount: "1380.50", status: "Open" }]).open_total
    ).toBe(1380.5)
  })

  it("never yields NaN from a junk amount", () => {
    expect(
      foldPartnerCredits([
        { amount: "not-a-number", status: "Open" },
        { amount: 100, status: "Open" },
      ]).open_total
    ).toBe(100)
  })

  it("rounds to two places rather than trailing float error", () => {
    expect(
      foldPartnerCredits([
        { amount: 0.1, status: "Open" },
        { amount: 0.2, status: "Open" },
      ]).open_total
    ).toBe(0.3)
  })

  it("prefers an Open credit's currency over a stale Applied one", () => {
    expect(
      foldPartnerCredits([
        { amount: 5, status: "Applied", currency_code: "usd" },
        { amount: 5, status: "Open", currency_code: "inr" },
      ]).currency
    ).toBe("inr")
  })
})
