/**
 * #2028 item 5 — a partner's own production is their EXPENSE, not our payable.
 *
 * #2040 stopped it auto-drafting. This is the visibility half: it still shows
 * in admin, with the money on it, in its own bucket — because a partner cannot
 * self-pay, so the cost is theirs to bear and ours only to display.
 */

import {
  splitPartnerExpenseRuns,
  partnerExpenseRows,
  partnerExpenseTotal,
} from "../lib/partner-expense-runs"

const SELF_SERVE = { source: "partner.self_serve" }

const run = (over: Record<string, any> = {}) => ({
  id: "run_1",
  design_id: "des_1",
  partner_id: "part_1",
  status: "completed",
  quantity: 2,
  partner_cost_estimate: 500,
  cost_type: "per_unit" as const,
  completed_at: "2026-09-10T12:00:00.000Z",
  ...over,
})

describe("splitPartnerExpenseRuns", () => {
  it("separates the partner's own production from commissioned work", () => {
    const own = run({ id: "own", metadata: SELF_SERVE })
    const ours = run({ id: "ours", metadata: { source: "admin.designs.manual" } })
    const bare = run({ id: "bare" })

    const { commissioned, ownProduction } = splitPartnerExpenseRuns([own, ours, bare])

    expect(ownProduction.map((r) => r.id)).toEqual(["own"])
    // A run with no marker at all is OURS. Absence of the self-serve stamp is
    // the default, and defaulting the other way would stop paying for real work.
    expect(commissioned.map((r) => r.id)).toEqual(["ours", "bare"])
  })

  it("survives an empty or absent list", () => {
    expect(splitPartnerExpenseRuns([])).toEqual({ commissioned: [], ownProduction: [] })
    expect(splitPartnerExpenseRuns(null)).toEqual({ commissioned: [], ownProduction: [] })
  })
})

describe("partnerExpenseRows", () => {
  it("prices the run and names the design", () => {
    const rows = partnerExpenseRows(
      [run({ metadata: SELF_SERVE, produced_quantity: 2 })],
      new Map([["des_1", "Tweed Jacket"]])
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      run_id: "run_1",
      design_name: "Tweed Jacket",
      quantity: 2,
      unit_amount: 500,
      amount: 1000,
      costed: true,
    })
  })

  it("returns null for an unknown design rather than an id dressed as a name", () => {
    const rows = partnerExpenseRows([run({ metadata: SELF_SERVE })], new Map())
    expect(rows[0].design_name).toBeNull()
    // And with no lookup passed at all.
    expect(partnerExpenseRows([run({ metadata: SELF_SERVE })])[0].design_name).toBeNull()
  })

  /**
   * The one that would quietly put a partner's own job back on the payable
   * list: a self-serve run with no cost. `costed: false` says the price was
   * never written down — it does NOT demote the run out of this bucket.
   */
  it("keeps an unpriced self-serve run in the bucket, at zero", () => {
    const rows = partnerExpenseRows([
      run({ metadata: SELF_SERVE, partner_cost_estimate: null }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(0)
    expect(rows[0].costed).toBe(false)
  })

  it("orders newest first", () => {
    const rows = partnerExpenseRows([
      run({ id: "old", metadata: SELF_SERVE, completed_at: "2026-01-01T00:00:00.000Z" }),
      run({ id: "new", metadata: SELF_SERVE, completed_at: "2026-09-01T00:00:00.000Z" }),
      run({ id: "undated", metadata: SELF_SERVE, completed_at: null }),
    ])
    expect(rows.map((r) => r.run_id)).toEqual(["new", "old", "undated"])
  })

  it("bills a `total` run verbatim, not unit x quantity (#1596)", () => {
    const rows = partnerExpenseRows([
      run({
        metadata: SELF_SERVE,
        cost_type: "total",
        partner_cost_estimate: 10000,
        quantity: 9,
        produced_quantity: 7,
      }),
    ])
    // The agreed total, NOT a re-priced 7/9 of it.
    expect(rows[0].amount).toBe(10000)
    expect(rows[0].unit_is_derived).toBe(true)
  })
})

describe("partnerExpenseTotal", () => {
  it("sums what the partner spent", () => {
    const rows = partnerExpenseRows([
      run({ id: "a", metadata: SELF_SERVE, partner_cost_estimate: 500, quantity: 2 }),
      run({ id: "b", metadata: SELF_SERVE, partner_cost_estimate: 300, quantity: 1 }),
    ])
    expect(partnerExpenseTotal(rows)).toBe(1300)
  })

  it("is 0 for nothing, and unbothered by uncosted rows", () => {
    expect(partnerExpenseTotal([])).toBe(0)
    const rows = partnerExpenseRows([
      run({ metadata: SELF_SERVE, partner_cost_estimate: null }),
    ])
    expect(partnerExpenseTotal(rows)).toBe(0)
  })
})
