import { describe, expect, it } from "vitest"

import {
  groupIntoRateBands,
  money,
  perUnit,
  provenanceLabel,
  runBillsVerbatimTotal,
  runLineAmount,
  runNeedsTypedPrice,
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

/**
 * The partner create screen's half of #1596. It collapsed two runs of one
 * design at different rates into a typed line TOTAL — the money right and the
 * account of how it was reached discarded — because there was no way to send
 * the bands. This is that grouping.
 *
 * 🔴 Mirrors `groupIntoRateBands` in the backend, which owns the shape. These
 * cases exist so the two cannot drift apart silently: the backend validator
 * refuses fewer than two bands and refuses a non-positive figure, and a screen
 * that disagrees turns a mistyped box into a 400 for the whole submission.
 */
describe("groupIntoRateBands (#1596)", () => {
  it("merges runs at the same rate and orders the bands by rate", () => {
    expect(
      groupIntoRateBands([
        { quantity: 1, unit_amount: 1200 },
        { quantity: 2, unit_amount: 850 },
        { quantity: 1, unit_amount: 850 },
      ])
    ).toEqual([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
  })

  it("does not depend on the order runs were ticked", () => {
    expect(
      groupIntoRateBands([
        { quantity: 1, unit_amount: 1200 },
        { quantity: 3, unit_amount: 850 },
      ])
    ).toEqual(
      groupIntoRateBands([
        { quantity: 3, unit_amount: 850 },
        { quantity: 1, unit_amount: 1200 },
      ])
    )
  })

  it("returns null when one rate covers every run — that is an ordinary line", () => {
    expect(
      groupIntoRateBands([
        { quantity: 3, unit_amount: 850 },
        { quantity: 5, unit_amount: 850 },
      ])
    ).toBeNull()
    expect(groupIntoRateBands([])).toBeNull()
    expect(groupIntoRateBands(null)).toBeNull()
  })

  it("drops figures the backend validator would refuse", () => {
    expect(
      groupIntoRateBands([
        { quantity: 3, unit_amount: 850 },
        { quantity: 0, unit_amount: 1200 },
        { quantity: 1, unit_amount: 1200 },
      ])
    ).toEqual([
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
  })

  it("keeps a summed fractional quantity off the float's edge", () => {
    expect(
      groupIntoRateBands([
        { quantity: 0.1, unit_amount: 850 },
        { quantity: 0.2, unit_amount: 850 },
        { quantity: 1, unit_amount: 1200 },
      ])
    ).toEqual([
      { quantity: 0.3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ])
  })

  it("sums to exactly the total the collapsed line used to send", () => {
    const runs = [
      { quantity: 3, unit_amount: 850 },
      { quantity: 1, unit_amount: 1200 },
    ]
    const bands = groupIntoRateBands(runs)!
    const banded = bands.reduce((s, b) => s + b.quantity * b.unit_amount, 0)
    const oldTotal = runs.reduce((s, r) => s + r.quantity * r.unit_amount, 0)
    expect(Math.round(banded * 100) / 100).toBe(Math.round(oldTotal * 100) / 100)
  })
})

/**
 * #1679 on the PARTNER side, and #1676's remainder.
 *
 * This screen used to compute `unit_amount × quantity` for every run, so a job
 * agreed at ₹10,000 as a TOTAL — 9 ordered, 7 made — was offered at ₹7,777.77
 * here while the admin screen offered ₹10,000 for the same run on the same day.
 * A partner submitting their own draft under-claimed by 22%, and by a paisa
 * even when produced equalled ordered.
 */
describe("runLineAmount — a total is the agreed price (#1679)", () => {
  const totalRun = {
    quantity: 7,
    rate: 1111.11,
    amount: 10000,
    unit_is_derived: true,
    hasTypedRate: false,
  }

  it("bills the agreed total verbatim, not the derived rate × quantity", () => {
    expect(runLineAmount(totalRun)).toBe(10000)
    expect(runLineAmount(totalRun)).not.toBe(7777.77)
  })

  it("loses no paisa when produced equals ordered", () => {
    // 10000/9 = 1111.11, × 9 = 9999.99. The rounding that made a ₹10,000 job
    // pay ₹9,999.99.
    expect(runLineAmount({ ...totalRun, quantity: 9 })).toBe(10000)
  })

  it("multiplies once a rate is typed — that is the deliberate way out", () => {
    expect(
      runLineAmount({ ...totalRun, rate: 1400, hasTypedRate: true })
    ).toBe(9800)
  })

  it("multiplies a genuine per-unit rate", () => {
    expect(
      runLineAmount({
        quantity: 7,
        rate: 1200,
        amount: 8400,
        unit_is_derived: false,
        hasTypedRate: false,
      })
    ).toBe(8400)
  })

  it("bills NOTHING for the remainder of a partly-billed total run (#1676)", () => {
    // Re-billing the total double-pays; dividing it re-prices. Neither is an
    // answer this screen may invent, so it states none and the submit guard
    // refuses until somebody types one.
    expect(
      runLineAmount({ ...totalRun, quantity: 5, alreadyPartlyBilled: true })
    ).toBe(0)
    expect(
      runNeedsTypedPrice({
        unit_is_derived: true,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).toBe(true)
    expect(
      runBillsVerbatimTotal({
        unit_is_derived: true,
        hasTypedRate: false,
        alreadyPartlyBilled: true,
      })
    ).toBe(false)
  })

  it("prices the remainder from the moment a rate is typed", () => {
    expect(
      runLineAmount({
        ...totalRun,
        quantity: 5,
        rate: 1400,
        hasTypedRate: true,
        alreadyPartlyBilled: true,
      })
    ).toBe(7000)
  })
})
