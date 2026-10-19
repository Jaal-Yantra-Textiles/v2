/**
 * #2433 — a priced, completed run whose draft is REFUSED must tell a person.
 * The ordinary skips (no price, already claimed) must not: they are expected
 * states, and alerting on them would bury the one that matters.
 */
const runMock = jest.fn()
jest.mock("../create-payment-submission", () => ({
  createPaymentSubmissionWorkflow: jest.fn(() => ({ run: runMock })),
}))

import { autoDraftRunPayout } from "../lib/auto-draft-run-payout"

const RUN = {
  id: "run_1",
  status: "completed",
  design_id: "des_1",
  partner_id: "part_1",
  quantity: 4,
  partner_cost_estimate: 1000,
  cost_type: "per_unit" as const,
}

const buildContainer = (run: any, priorItems: any[] = []) => {
  const createNotifications = jest.fn().mockResolvedValue({ id: "noti_1" })
  const productionRuns = {
    retrieveProductionRun: jest.fn().mockResolvedValue(run),
    listProductionRuns: jest.fn().mockResolvedValue([]),
  }
  const paymentSubmissions = {
    listPaymentSubmissionItems: jest.fn().mockResolvedValue(priorItems),
  }
  return {
    createNotifications,
    container: {
      resolve: jest.fn((key: string) => {
        if (key === "production_runs") return productionRuns
        if (key === "logger") return { info: jest.fn(), warn: jest.fn() }
        if (key === "notification") return { createNotifications }
        return paymentSubmissions
      }),
    } as any,
  }
}

describe("autoDraftRunPayout — a refused draft raises an admin alert", () => {
  beforeEach(() => {
    runMock.mockReset()
  })

  it("alerts when the create workflow refuses a payable run", async () => {
    runMock.mockRejectedValue(
      new Error("Designs not assigned to this partner: des_1")
    )
    const { container, createNotifications } = buildContainer(RUN)

    const out = await autoDraftRunPayout(container, "run_1")

    expect(out).toMatchObject({ drafted: false, reason: "refused" })
    expect(createNotifications).toHaveBeenCalledTimes(1)
    const [arg] = createNotifications.mock.calls[0]
    expect(arg.data.metadata).toMatchObject({
      production_run_id: "run_1",
      partner_id: "part_1",
      design_id: "des_1",
      // per_unit 1000 x ordered 4 — the amount that is now unpaid.
      amount: 4000,
      reason: "payout_draft_refused",
      source: "production_run.completed",
    })
    expect(arg.data.metadata.refusal).toContain("not assigned to this partner")
  })

  it("does not alert when the draft is created", async () => {
    runMock.mockResolvedValue({ result: { submission: { id: "psub_1" } } })
    const { container, createNotifications } = buildContainer(RUN)

    const out = await autoDraftRunPayout(container, "run_1")

    expect(out.drafted).toBe(true)
    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("does not alert for a run with no price — an expected state, not a refusal", async () => {
    const { container, createNotifications } = buildContainer({
      ...RUN,
      partner_cost_estimate: null,
    })

    const out = await autoDraftRunPayout(container, "run_1")

    expect(out.reason).toBe("no_cost")
    expect(runMock).not.toHaveBeenCalled()
    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("does not alert when the run is already claimed", async () => {
    const { container, createNotifications } = buildContainer(RUN, [
      { production_run_ids: ["run_1"] },
    ])

    const out = await autoDraftRunPayout(container, "run_1")

    expect(out.reason).toBe("already_claimed")
    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("still returns refused when the notifier itself is down", async () => {
    runMock.mockRejectedValue(new Error("Designs not assigned to this partner"))
    const { container, createNotifications } = buildContainer(RUN)
    createNotifications.mockRejectedValue(new Error("feed down"))

    await expect(autoDraftRunPayout(container, "run_1")).resolves.toMatchObject({
      drafted: false,
      reason: "refused",
    })
  })
})
