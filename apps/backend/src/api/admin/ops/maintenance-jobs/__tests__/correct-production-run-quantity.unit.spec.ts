import { claimedQuantityForRun } from "../correct-production-run-quantity-job"

/**
 * What a run has already been billed for.
 *
 * 🔴 This is the number that decides whether a quantity may be LOWERED. Get it
 * too low and previously valid claims silently become retroactive overclaims;
 * the run and its submissions would disagree with nothing to notice.
 *
 * Read from the submission ITEMS, because the run holds no record of what has
 * been billed against it — the same reason `/production-runs/:id/payments`
 * exists at all.
 */
describe("claimedQuantityForRun", () => {
  const RUN = "prod_run_A"

  it("sums every line that names this run", () => {
    expect(
      claimedQuantityForRun(
        [
          { production_run_ids: [RUN], quantity: 2 },
          { production_run_ids: [RUN], quantity: 1 },
        ],
        RUN
      )
    ).toBe(3)
  })

  it("🔴 ignores lines for OTHER runs", () => {
    // A line naming a different run must not raise this run's floor, or a
    // perfectly valid lowering gets refused for someone else's billing.
    expect(
      claimedQuantityForRun(
        [
          { production_run_ids: ["prod_run_B"], quantity: 50 },
          { production_run_ids: [RUN], quantity: 2 },
        ],
        RUN
      )
    ).toBe(2)
  })

  it("counts a line that spans several runs, including this one", () => {
    // One submission line can cover several runs; it still claims against each.
    expect(
      claimedQuantityForRun(
        [{ production_run_ids: ["prod_run_B", RUN], quantity: 4 }],
        RUN
      )
    ).toBe(4)
  })

  it("treats a missing quantity as 0, not as a reason to skip the line", () => {
    expect(
      claimedQuantityForRun(
        [
          { production_run_ids: [RUN], quantity: null },
          { production_run_ids: [RUN], quantity: 2 },
        ],
        RUN
      )
    ).toBe(2)
  })

  it("is 0 when nothing has been claimed", () => {
    expect(claimedQuantityForRun([], RUN)).toBe(0)
    expect(claimedQuantityForRun([{ production_run_ids: null, quantity: 9 }], RUN)).toBe(0)
  })
})
