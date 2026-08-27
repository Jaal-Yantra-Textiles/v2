/**
 * The sweep decides what to rewrite in a money column nobody is watching.
 *
 * Every "skipped" case below is one where a confident answer would rewrite
 * what a partner is owed on a guess — which is why the sweep is a job with a
 * dry run rather than a subscriber, and why silence is never the report.
 */
import {
  assessDraftLine,
  summarizeDraftSweep,
  type DraftPayoutLine,
  type ExpectedPayout,
} from "../lib/stale-draft-payout"

const line = (over: Partial<DraftPayoutLine> = {}): DraftPayoutLine => ({
  item_id: "psi_1",
  submission_id: "ps_1",
  design_id: "des_1",
  production_run_ids: ["run_1"],
  run_provenance: "recorded",
  amount: 3570,
  quantity: 3,
  unit_amount: 1190,
  ...over,
})

const expected = (over: Partial<ExpectedPayout> = {}): ExpectedPayout => ({
  eligible: true,
  amount: 3570,
  quantity: 3,
  unit_amount: 1190,
  ...over,
})

describe("assessDraftLine", () => {
  it("leaves a line that still matches its run alone", () => {
    expect(assessDraftLine(line(), expected()).verdict).toBe("current")
  })

  it("names the drift when the run's money has moved", () => {
    // The prod case: drafted at 1190/unit × 3, run since corrected to 840
    // total for 1. The draft still said 3570 and nothing disagreed with it.
    const result = assessDraftLine(
      line(),
      expected({ amount: 840, quantity: 1, unit_amount: 840 })
    )
    expect(result.verdict).toBe("stale")
    if (result.verdict !== "stale") throw new Error("unreachable")
    expect(result.reason).toContain("run_1")
    expect(result.reason).toContain("3570")
    expect(result.reason).toContain("840")
    expect(result.expected.amount).toBe(840)
  })

  it("catches a quantity-only correction", () => {
    // Same rate, fewer pieces. The amount happens to be re-derived elsewhere,
    // but a draft whose quantity disagrees with its run is still stale.
    const result = assessDraftLine(
      line({ amount: 1190, quantity: 3, unit_amount: 1190 }),
      expected({ amount: 1190, quantity: 1, unit_amount: 1190 })
    )
    expect(result.verdict).toBe("stale")
  })

  it("tolerates a bigNumber round-trip rather than reporting a phantom drift", () => {
    // Money is 2dp; a hair of float must not make every line look stale and
    // bury the real ones in noise.
    const result = assessDraftLine(
      line({ amount: 3570.0000001 }),
      expected()
    )
    expect(result.verdict).toBe("current")
  })

  it("🔴 does NOT treat a run with no payable figure as worth zero", () => {
    // Rate cleared or run reopened. Writing 0 would read as a decision that
    // the work was worthless — the #1564 mistake exactly.
    const result = assessDraftLine(line(), expected({ eligible: false }))
    expect(result.verdict).toBe("skipped")
    if (result.verdict !== "skipped") throw new Error("unreachable")
    expect(result.reason).toMatch(/worthless|payable/i)
  })

  it("🔴 refuses a line whose provenance is not `recorded`", () => {
    // `not_recorded` means the run was never written down, so nothing here can
    // say whether the line is stale. Guessing rewrites a payout blind.
    for (const provenance of ["not_recorded", "no_run", null]) {
      const result = assessDraftLine(
        line({ run_provenance: provenance }),
        expected({ amount: 1 })
      )
      expect(result.verdict).toBe("skipped")
    }
  })

  it("🔴 does not infer provenance from the run ids", () => {
    // The whole reason `run_provenance` exists is that `production_run_ids`
    // meant three different things. A line naming runs but flagged
    // `not_recorded` must still be skipped.
    const result = assessDraftLine(
      line({ run_provenance: "not_recorded", production_run_ids: ["run_1"] }),
      expected({ amount: 1 })
    )
    expect(result.verdict).toBe("skipped")
  })

  it("refuses a `recorded` line that names no runs", () => {
    const result = assessDraftLine(
      line({ production_run_ids: [] }),
      expected({ amount: 1 })
    )
    expect(result.verdict).toBe("skipped")
    if (result.verdict !== "skipped") throw new Error("unreachable")
    expect(result.reason).toMatch(/names no runs/i)
  })

  it("🔴 refuses a line that collapses several runs into one figure", () => {
    // Re-pricing from one run's payout would bill one run's work as though it
    // were all of it — #1554 arrived at from the other direction.
    const result = assessDraftLine(
      line({ production_run_ids: ["run_1", "run_2"] }),
      expected({ amount: 840 })
    )
    expect(result.verdict).toBe("skipped")
    if (result.verdict !== "skipped") throw new Error("unreachable")
    expect(result.reason).toContain("2 runs")
  })

  it("treats a null amount as drift rather than as a match", () => {
    // An unpriced draft line against an eligible run is exactly what the
    // sweep is for; `null == 0` style leniency would hide it.
    const result = assessDraftLine(line({ amount: null }), expected())
    expect(result.verdict).toBe("stale")
  })
})

describe("summarizeDraftSweep", () => {
  it("says plainly when there was nothing to examine", () => {
    expect(
      summarizeDraftSweep({ examined: 0, stale: 0, current: 0, skipped: 0, dryRun: true })
    ).toMatch(/no unclaimed draft/i)
  })

  it("🔴 reports skipped as its own number, not folded into examined", () => {
    // "3 of 200 stale" while 150 were unknowable tells the operator the
    // opposite of the truth about the sweep's own coverage.
    const out = summarizeDraftSweep({
      examined: 200,
      stale: 3,
      current: 47,
      skipped: 150,
      dryRun: true,
    })
    expect(out).toContain("150 skipped")
    expect(out).toContain("3 would be re-priced")
  })

  it("says nothing about skipping when nothing was skipped", () => {
    const out = summarizeDraftSweep({
      examined: 10, stale: 1, current: 9, skipped: 0, dryRun: false,
    })
    expect(out).not.toMatch(/skipped/i)
    expect(out).toContain("1 re-priced")
  })

  it("distinguishes a dry run from an apply in words, not just a flag", () => {
    const dry = summarizeDraftSweep({ examined: 5, stale: 2, current: 3, skipped: 0, dryRun: true })
    const wet = summarizeDraftSweep({ examined: 5, stale: 2, current: 3, skipped: 0, dryRun: false })
    expect(dry).toContain("would be re-priced")
    expect(wet).toContain("re-priced")
    expect(wet).not.toContain("would be")
  })
})
