import {
  appliedCreditsFor,
  canApplyToStatus,
  checkCreditApplicable,
  remainingClaim,
} from "../apply-credit"

/**
 * hrhandloom's real numbers throughout: a 1,380 credit born from being paid
 * 30,000 against a 28,620 payout, earmarked for the still-open order
 * 01K36TE2WB.
 */
const CREDIT = {
  amount: 1380,
  status: "Open",
  currency_code: "inr",
}

const PAYOUT = {
  total_amount: 10000,
  status: "Approved",
  currency: "inr",
}

describe("remainingClaim (#1712)", () => {
  it("takes off both settled money and credits already applied", () => {
    expect(
      remainingClaim({
        submissionAmount: 10000,
        settledAmount: 4000,
        appliedCreditsTotal: 1380,
      })
    ).toBe(4620)
  })

  it("floors at zero rather than reporting negative headroom", () => {
    // An over-settled payout is a fact for the ledger to show, not room a
    // further credit may be applied into.
    expect(
      remainingClaim({ submissionAmount: 1000, settledAmount: 1500 })
    ).toBe(0)
  })

  it("treats a missing settlement as nothing settled, not as an error", () => {
    expect(remainingClaim({ submissionAmount: 10000 })).toBe(10000)
  })

  /** #1613: money arrives fractional, and an integer rounded 11.8 to 12. */
  it("keeps two decimals", () => {
    expect(
      remainingClaim({ submissionAmount: 100.55, settledAmount: 10.1 })
    ).toBe(90.45)
  })
})

describe("canApplyToStatus (#1712)", () => {
  it("refuses Paid — the money already moved in full", () => {
    expect(canApplyToStatus("Paid")).toBe(false)
  })

  it("refuses Rejected — a rejected claim owes nothing", () => {
    expect(canApplyToStatus("Rejected")).toBe(false)
  })

  it("allows the statuses that still owe", () => {
    expect(canApplyToStatus("Approved")).toBe(true)
    expect(canApplyToStatus("Submitted")).toBe(true)
    expect(canApplyToStatus("Draft")).toBe(true)
  })
})

describe("checkCreditApplicable (#1712)", () => {
  it("allows a credit that fits, and reports both sides of the claim", () => {
    const v = checkCreditApplicable({ credit: CREDIT, submission: PAYOUT })
    expect(v.ok).toBe(true)
    if (!v.ok) throw new Error("expected ok")
    expect(v.remaining_before).toBe(10000)
    expect(v.remaining_after).toBe(8620)
  })

  it("counts money already settled against the payout", () => {
    const v = checkCreditApplicable({
      credit: CREDIT,
      submission: PAYOUT,
      settledAmount: 8000,
    })
    expect(v.ok).toBe(true)
    if (!v.ok) throw new Error("expected ok")
    expect(v.remaining_before).toBe(2000)
    expect(v.remaining_after).toBe(620)
  })

  /**
   * 🔴 The defect this whole model exists to avoid, one level up: a silent
   * clamp is what hid the 1,380 in the first place.
   */
  it("REFUSES rather than clamping when the credit is larger than what is left", () => {
    const v = checkCreditApplicable({
      credit: CREDIT,
      submission: PAYOUT,
      settledAmount: 9500,
    })
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error("expected refusal")
    expect(v.refusal.code).toBe("exceeds_remaining")
    // Both numbers are named — an operator must not need the database to see why.
    expect(v.refusal.message).toContain("1380")
    expect(v.refusal.message).toContain("500")
    expect(v.remaining_before).toBe(500)
  })

  it("refuses a credit that is not Open", () => {
    for (const status of ["Applied", "Cancelled"]) {
      const v = checkCreditApplicable({
        credit: { ...CREDIT, status },
        submission: PAYOUT,
      })
      expect(v.ok).toBe(false)
      if (v.ok) throw new Error("expected refusal")
      expect(v.refusal.code).toBe("credit_not_open")
    }
  })

  it("refuses a Paid payout — that would claim the money was given twice", () => {
    const v = checkCreditApplicable({
      credit: CREDIT,
      submission: { ...PAYOUT, status: "Paid" },
    })
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error("expected refusal")
    expect(v.refusal.code).toBe("submission_paid")
  })

  it("refuses a Rejected payout — it would destroy money the partner holds", () => {
    const v = checkCreditApplicable({
      credit: CREDIT,
      submission: { ...PAYOUT, status: "Rejected" },
    })
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error("expected refusal")
    expect(v.refusal.code).toBe("submission_rejected")
  })

  it("refuses across currencies rather than inventing a rate", () => {
    const v = checkCreditApplicable({
      credit: { ...CREDIT, currency_code: "eur" },
      submission: PAYOUT,
    })
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error("expected refusal")
    expect(v.refusal.code).toBe("currency_mismatch")
  })

  /**
   * ⚠️ A missing currency is not a mismatch. Refusing on it would block every
   * historical row written before the column carried a value.
   */
  it("does not refuse when either side states no currency", () => {
    expect(
      checkCreditApplicable({
        credit: { ...CREDIT, currency_code: null },
        submission: PAYOUT,
      }).ok
    ).toBe(true)
    expect(
      checkCreditApplicable({
        credit: CREDIT,
        submission: { ...PAYOUT, currency: null },
      }).ok
    ).toBe(true)
  })

  it("allows a credit that exactly consumes the remainder", () => {
    const v = checkCreditApplicable({
      credit: CREDIT,
      submission: PAYOUT,
      settledAmount: 8620,
    })
    expect(v.ok).toBe(true)
    if (!v.ok) throw new Error("expected ok")
    expect(v.remaining_after).toBe(0)
  })

  it("counts credits already applied to the same payout", () => {
    // 10,000 payout, 8,000 already credited: 1,380 no longer fits.
    const v = checkCreditApplicable({
      credit: { ...CREDIT, amount: 2500 },
      submission: PAYOUT,
      appliedCreditsTotal: 8000,
    })
    expect(v.ok).toBe(false)
    if (v.ok) throw new Error("expected refusal")
    expect(v.refusal.code).toBe("exceeds_remaining")
    expect(v.remaining_before).toBe(2000)
  })
})

describe("appliedCreditsFor (#1712)", () => {
  const rows = [
    { id: "c1", amount: 1380, status: "Applied", applied_to_submission_id: "sub_1" },
    { id: "c2", amount: 500, status: "Open", applied_to_submission_id: null },
    { id: "c3", amount: 900, status: "Applied", applied_to_submission_id: "sub_2" },
    { id: "c4", amount: 120, status: "Cancelled", applied_to_submission_id: "sub_1" },
    { id: "c5", amount: 20.5, status: "Applied", applied_to_submission_id: "sub_1" },
  ]

  it("sums only Applied credits naming THIS payout", () => {
    const { total, ids } = appliedCreditsFor("sub_1", rows)
    expect(total).toBe(1400.5)
    expect(ids).toEqual(["c1", "c5"])
  })

  /**
   * 🔑 An Open credit has discharged nothing and a Cancelled one never will.
   * Counting either would report a payout as smaller than it is — an
   * undercharge shaped exactly like the ones that underpaid partners before.
   */
  it("ignores Open, Cancelled, and credits applied elsewhere", () => {
    expect(appliedCreditsFor("sub_3", rows).total).toBe(0)
    expect(appliedCreditsFor("sub_2", rows).ids).toEqual(["c3"])
  })

  it("handles a missing list", () => {
    expect(appliedCreditsFor("sub_1", null).total).toBe(0)
    expect(appliedCreditsFor("sub_1", undefined).ids).toEqual([])
  })
})
