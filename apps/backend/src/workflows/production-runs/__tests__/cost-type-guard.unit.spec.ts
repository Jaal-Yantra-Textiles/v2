import { costTypeGuardMessage } from "../lib/cost-type-guard"

/**
 * #1554 — `production_run.cost_type` is `.default("total")`, and every reader
 * treats an absent value as a total. So a partner typing their PER-PIECE rate
 * into a form that never made them choose stored a per-piece figure labelled
 * "total", and the payout billed it once: ₹850 for nine garments, with nothing
 * erroring and the number looking plausible.
 */
describe("costTypeGuardMessage", () => {
  it("refuses a cost with no type", () => {
    expect(costTypeGuardMessage({ partner_cost_estimate: 850 })).toMatch(
      /cost_type is required/
    )
  })

  it("refuses a cost with a type it does not recognise", () => {
    expect(
      costTypeGuardMessage({ partner_cost_estimate: 850, cost_type: "each" })
    ).toBeTruthy()
    expect(
      costTypeGuardMessage({ partner_cost_estimate: 850, cost_type: "" })
    ).toBeTruthy()
  })

  it("accepts either valid pairing", () => {
    expect(
      costTypeGuardMessage({ partner_cost_estimate: 850, cost_type: "per_unit" })
    ).toBeNull()
    expect(
      costTypeGuardMessage({ partner_cost_estimate: 7650, cost_type: "total" })
    ).toBeNull()
  })

  /**
   * ⚠️ Deliberately NOT symmetric. A cost_type on its own is how a correction
   * re-labels a figure that is already stored — the ops correction job relies
   * on exactly that — so requiring an amount here would break it.
   */
  it("allows a type with no amount, which is how a correction re-labels one", () => {
    expect(costTypeGuardMessage({ cost_type: "per_unit" })).toBeNull()
    expect(costTypeGuardMessage({})).toBeNull()
  })

  it("says nothing about a cleared or absent cost", () => {
    expect(costTypeGuardMessage({ partner_cost_estimate: null })).toBeNull()
    expect(costTypeGuardMessage({ partner_cost_estimate: 0 })).toBeNull()
    expect(costTypeGuardMessage(null)).toBeNull()
  })

  it("names both options in the refusal, so the caller can act on it", () => {
    const message = costTypeGuardMessage({ partner_cost_estimate: 1 }) || ""
    expect(message).toContain("per_unit")
    expect(message).toContain("total")
  })
})
