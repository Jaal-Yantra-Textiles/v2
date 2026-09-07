/**
 * #1877 — the rollup guard in `assessRunPayout` reads `child_run_count`, which
 * is FETCHED rather than stored. A call site that forgets to hydrate gets no
 * guard at all, and it types perfectly. This is the test that says the call
 * site actually asks.
 */
const runMock = jest.fn()
jest.mock("../create-payment-submission", () => ({
  createPaymentSubmissionWorkflow: jest.fn(() => ({ run: runMock })),
}))

import { autoDraftRunPayout } from "../lib/auto-draft-run-payout"

const PARENT = {
  id: "run_parent",
  status: "completed",
  design_id: "des_1",
  partner_id: "part_1",
  // The SUM of its children's quantities — what would have been billed.
  quantity: 10,
  partner_cost_estimate: 850,
  cost_type: "per_unit" as const,
}

const buildContainer = (run: any, children: any[]) => {
  const listProductionRuns = jest.fn().mockResolvedValue(children)
  const productionRuns = {
    retrieveProductionRun: jest.fn().mockResolvedValue(run),
    listProductionRuns,
  }
  const paymentSubmissions = {
    listPaymentSubmissionItems: jest.fn().mockResolvedValue([]),
  }
  return {
    listProductionRuns,
    container: {
      resolve: jest.fn((key: string) => {
        if (key === "production_runs") return productionRuns
        if (key === "logger") return { info: jest.fn(), error: jest.fn() }
        return paymentSubmissions
      }),
    } as any,
  }
}

describe("autoDraftRunPayout — a rollup is never drafted", () => {
  beforeEach(() => {
    runMock.mockReset()
    runMock.mockResolvedValue({ result: { submission: { id: "psub_1" } } })
  })

  it("asks whether the run has children before judging it", async () => {
    const { container, listProductionRuns } = buildContainer(PARENT, [
      { id: "c1" },
      { id: "c2" },
    ])

    await autoDraftRunPayout(container, "run_parent")

    // Asserted on mock.calls AFTER the call — an expect() inside a mock body
    // can be swallowed by a catch.
    expect(listProductionRuns).toHaveBeenCalled()
    expect(listProductionRuns.mock.calls[0][0]).toEqual({
      parent_run_id: "run_parent",
    })
  })

  it("refuses with the aggregate reason and creates NOTHING", async () => {
    const { container } = buildContainer(PARENT, [{ id: "c1" }, { id: "c2" }])

    const out = await autoDraftRunPayout(container, "run_parent")

    expect(out.drafted).toBe(false)
    expect(out.reason).toBe("aggregate_run")
    // The money half: no submission was raised for the summed quantity.
    expect(runMock).not.toHaveBeenCalled()
  })

  it("still drafts for an ordinary run with no children", async () => {
    const { container } = buildContainer({ ...PARENT, id: "run_solo" }, [])

    const out = await autoDraftRunPayout(container, "run_solo")

    expect(out.reason).toBe("drafted")
    expect(out.drafted).toBe(true)
    expect(runMock).toHaveBeenCalledTimes(1)
    // 10 units at 850 — the guard must not have changed what an ordinary run pays.
    const input = runMock.mock.calls[0][0].input
    expect(input.quantities).toEqual({ des_1: 10 })
    expect(input.unit_amounts).toEqual({ des_1: 850 })
  })
})
