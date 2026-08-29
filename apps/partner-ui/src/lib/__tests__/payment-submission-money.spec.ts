import { describe, expect, it } from "vitest"

import {
  money,
  perUnit,
  provenanceLabel,
} from "../payment-submission-money"

/**
 * The detail screen is where a partner checks what they were actually paid
 * for. Every case below is one where the old screen said something confidently
 * wrong, or said nothing where silence reads as reassurance.
 */
describe("money", () => {
  it("uses the submission's own currency, not a hardcoded rupee", () => {
    // 🔴 The page printed `₹` in front of every amount while `currency` is a
    // real column. The number was right and the label was a lie.
    expect(money(1000, "usd")).toContain("1,000")
    expect(money(1000, "usd")).not.toContain("₹")
  })

  it("defaults to INR, which is what the column defaults to", () => {
    expect(money(850)).toContain("850")
  })

  it("is case-insensitive about the code", () => {
    expect(money(5, "EUR")).toBe(money(5, "eur"))
  })

  it("shows the number and the code rather than blanking on an unknown code", () => {
    // A currency we cannot format must not erase what a partner is owed.
    const out = money(1234, "zzz")
    expect(out).toContain("1,234")
    expect(out).toContain("ZZZ")
  })

  it("renders a dash for a missing amount rather than a confident zero", () => {
    expect(money(null)).toBe("—")
    expect(money(undefined)).toBe("—")
    expect(money("not a number")).toBe("—")
  })

  it("renders a real zero as zero", () => {
    // 0 is a legitimate amount here; only null/undefined are "no answer".
    expect(money(0, "inr")).toContain("0")
    expect(money(0, "inr")).not.toBe("—")
  })
})

describe("perUnit", () => {
  it("says what the line bills: quantity × rate", () => {
    const out = perUnit({ quantity: 9, unit_amount: 850 }, "inr")
    expect(out).toContain("9 ×")
    expect(out).toContain("850")
  })

  it("🔴 refuses to invent a rate by dividing the total", () => {
    // `amount` is authoritative; a line with no `unit_amount` never carried a
    // rate. Deriving one would show a number nobody entered as though the
    // partner had agreed to it.
    expect(perUnit({ quantity: 9, amount: 7650 }, "inr")).toBeNull()
    expect(perUnit({ quantity: 9, unit_amount: null, amount: 7650 })).toBeNull()
  })

  it("refuses a nonsense quantity rather than printing it", () => {
    expect(perUnit({ quantity: 0, unit_amount: 850 })).toBeNull()
    expect(perUnit({ quantity: -3, unit_amount: 850 })).toBeNull()
    expect(perUnit({ unit_amount: 850 })).toBeNull()
  })

  it("refuses a non-numeric rate", () => {
    expect(perUnit({ quantity: 2, unit_amount: "eight fifty" })).toBeNull()
  })

  it("handles a quantity of 1 without pretending it is special", () => {
    expect(perUnit({ quantity: 1, unit_amount: 850 }, "inr")).toContain("1 ×")
  })
})

/**
 * 🔴 `production_run_ids IS NULL` was doing the work of three different facts,
 * which is why `run_provenance` exists. These cases pin that the reader asks
 * the column rather than re-deriving the ambiguity.
 */
describe("provenanceLabel", () => {
  it("names the runs when they are recorded", () => {
    expect(provenanceLabel({
      run_provenance: "recorded",
      production_run_ids: ["run_1", "run_2"],
    })).toEqual({ text: "2 production runs", muted: false })
  })

  it("singularises one run", () => {
    expect(provenanceLabel({
      run_provenance: "recorded",
      production_run_ids: ["run_1"],
    })?.text).toBe("1 production run")
  })

  it("says nothing for work that no run produced", () => {
    // `no_run` is correct and final — a task, or a hand-picked design.
    expect(provenanceLabel({ run_provenance: "no_run" })).toBeNull()
    expect(
      provenanceLabel({ run_provenance: "no_run", production_run_ids: [] })
    ).toBeNull()
  })

  it("🔴 admits when run work was billed but never written down", () => {
    // Silence here would read as "no runs involved", which is the opposite of
    // what `not_recorded` means: it paid for run work we cannot identify.
    expect(provenanceLabel({ run_provenance: "not_recorded" })).toEqual({
      text: "Runs not recorded on this line",
      muted: true,
    })
  })

  it("🔴 does not let a 'recorded' line with no ids read as reassurance", () => {
    // A line claiming `recorded` while naming nothing is `not_recorded`
    // wearing the wrong label. It must not say "0 production runs" or go
    // quiet — both read as "nothing to see here".
    expect(provenanceLabel({
      run_provenance: "recorded",
      production_run_ids: [],
    })).toEqual({ text: "Runs not recorded on this line", muted: true })
  })

  it("says nothing when the column is absent entirely", () => {
    // An old row from before the column existed. We genuinely do not know, and
    // the honest default lives in the workflow, not in a guess on the screen.
    expect(provenanceLabel({})).toBeNull()
  })
})

/**
 * Per-piece prices (#1596). A partner may charge different rates for different
 * pieces of one run; before this, such a line's `unit_amount` was null and the
 * screen showed no breakdown at all — so a partner could not see the rates they
 * had themselves quoted.
 */
describe("perUnit — per-piece price bands", () => {
  it("shows every band on a mixed-price line", () => {
    const text = perUnit(
      {
        quantity: 4,
        unit_amount: null,
        rate_breakdown: [
          { quantity: 3, unit_amount: 850 },
          { quantity: 1, unit_amount: 1200 },
        ],
      },
      "inr"
    )

    expect(text).toContain("3 ×")
    expect(text).toContain("1 ×")
    expect(text).toContain("+")
  })

  it("ignores a single band — that is an ordinary priced line", () => {
    const text = perUnit(
      {
        quantity: 9,
        unit_amount: 850,
        rate_breakdown: [{ quantity: 9, unit_amount: 850 }],
      },
      "inr"
    )

    expect(text).toContain("9 ×")
    expect(text).not.toContain("+")
  })

  it("still says nothing for a typed total with no bands", () => {
    expect(perUnit({ quantity: 1, unit_amount: null }, "inr")).toBeNull()
  })

  it("never renders a malformed band as NaN at a partner", () => {
    const text = perUnit(
      {
        quantity: 4,
        unit_amount: null,
        rate_breakdown: [
          { quantity: 3, unit_amount: 850 },
          { quantity: "many", unit_amount: 1200 },
        ],
      },
      "inr"
    )

    expect(text).toBeNull()
  })
})
