import {
  assessRunPricing,
  daysSinceCompletion,
} from "../audit-unpriced-completed-runs-job"
import { runPayableOffer } from "../../../../../workflows/production-runs/lib/run-payable"

/**
 * #1712 defect 5 — `prod_run_01KP4ZVE3R` was completed, produced 2 pieces and
 * carried no price for four months. Nothing hid it; nothing reported it either.
 * These cover the one decision the report makes: does this run carry a price,
 * and if not, which kind of absence is it.
 */
describe("assessRunPricing", () => {
  it("reads a run with an agreed rate as priced", () => {
    expect(assessRunPricing({ partner_cost_estimate: 500 })).toEqual({
      verdict: "priced",
      agreed: 500,
    })
  })

  /**
   * 🔴 The distinction the whole report rests on. `Number(null)` is 0, so an
   * implementation that coerces before reading the raw field would report every
   * never-priced run as one that had a zero deliberately written to it — and
   * "nobody has said what this costs" is a different event from "something
   * decided this is worth nothing" (#1676, #1563).
   */
  it("separates a rate that was never recorded from a zero somebody wrote", () => {
    expect(assessRunPricing({ partner_cost_estimate: null }).verdict).toBe(
      "no_rate_recorded"
    )
    expect(assessRunPricing({ partner_cost_estimate: 0 }).verdict).toBe(
      "zero_rate_recorded"
    )
  })

  it("keeps the written zero on the row, and reports no figure for an absent one", () => {
    expect(assessRunPricing({ partner_cost_estimate: 0 }).agreed).toBe(0)
    expect(assessRunPricing({ partner_cost_estimate: null }).agreed).toBeNull()
  })

  it("treats an undefined field, a missing run and unparseable text as never recorded", () => {
    expect(assessRunPricing({}).verdict).toBe("no_rate_recorded")
    // `""` passes every `is not null` check and coerces to 0 — a blank is an
    // unanswered question, not a price of nothing.
    expect(
      assessRunPricing({ partner_cost_estimate: "" as any }).verdict
    ).toBe("no_rate_recorded")
    expect(assessRunPricing(null).verdict).toBe("no_rate_recorded")
    expect(
      assessRunPricing({ partner_cost_estimate: "abc" as any }).verdict
    ).toBe("no_rate_recorded")
  })

  /** A negative is a written figure, not an absent one — and still unpayable. */
  it("counts a negative as a written zero rather than a price", () => {
    expect(assessRunPricing({ partner_cost_estimate: -50 })).toEqual({
      verdict: "zero_rate_recorded",
      agreed: -50,
    })
  })

  /**
   * 🔑 The report and the payout screen must draw the SAME line, or this job
   * names partners the screen shows as payable (or stays silent about work the
   * screen refuses to price). Asserted against `runPayableOffer` itself rather
   * than against a remembered threshold.
   */
  it.each([
    [null, false],
    [0, false],
    [-1, false],
    [0.5, true],
    [500, true],
  ])(
    "agrees with runPayableOffer's payable flag for an estimate of %p",
    (estimate, expectedPayable) => {
      const run = {
        partner_cost_estimate: estimate as any,
        cost_type: "per_unit" as const,
        quantity: 2,
        produced_quantity: 2,
      }
      expect(runPayableOffer(run).payable).toBe(expectedPayable)
      expect(assessRunPricing(run).verdict === "priced").toBe(expectedPayable)
    }
  )

  /**
   * The real row. `cost_type: total` with no estimate is the shape that priced
   * at 0 and read as "nothing owed" for four months.
   */
  it("reports the Flowy Skirt shape as unpriced", () => {
    const flowySkirt = {
      id: "prod_run_01KP4ZVE3R",
      partner_cost_estimate: null,
      cost_type: "total" as const,
      quantity: 2,
      produced_quantity: 2,
    }
    expect(assessRunPricing(flowySkirt).verdict).toBe("no_rate_recorded")
    expect(runPayableOffer(flowySkirt).amount).toBe(0)
  })
})

describe("daysSinceCompletion", () => {
  const now = new Date("2026-09-02T00:00:00.000Z")

  it("counts whole days from the completion stamp", () => {
    expect(daysSinceCompletion("2026-05-02T00:00:00.000Z", now)).toBe(123)
  })

  /**
   * ⚠️ An unknown age is not an age of zero. A run with no completion stamp
   * sorted as "finished today" would rank at the bottom of a longest-waiting
   * list and never be looked at.
   */
  it("returns null for a run with no completion stamp, not 0", () => {
    expect(daysSinceCompletion(null, now)).toBeNull()
    expect(daysSinceCompletion(undefined, now)).toBeNull()
    expect(daysSinceCompletion("not a date", now)).toBeNull()
  })

  it("does not report a future completion as a negative age", () => {
    expect(daysSinceCompletion("2026-10-01T00:00:00.000Z", now)).toBeNull()
  })
})
