const jobRun = jest.fn()

jest.mock("../../api/admin/ops/maintenance-jobs/apply-committed-consumption-job", () => ({
  applyCommittedConsumptionJob: { run: (...args: any[]) => jobRun(...args) },
}))
jest.mock("@medusajs/medusa/core-flows", () => ({ emitEventStep: jest.fn() }))

import handler, { config } from "../consumption-committed-apply-to-inventory"

/**
 * #2406 — committing consumption applies exactly the committed logs to stock,
 * one apply at a time, and says what happened on the run's timeline.
 */
const makeContainer = (logs: Array<Record<string, any>>) => {
  const createProductionRunActivities = jest.fn().mockResolvedValue(undefined)
  const logger = { info: jest.fn(), error: jest.fn() }
  const container = {
    resolve: (key: string) => {
      if (key === "logger") return logger
      if (key === "production_runs") {
        return {
          retrieveProductionRun: jest.fn(async (id: string) => ({ id, partner_id: "partner_1" })),
          createProductionRunActivities,
        }
      }
      return {
        listAndCountConsumptionLogs: jest.fn(async () => [logs, logs.length]),
      }
    },
  } as any
  return { container, createProductionRunActivities, logger }
}

beforeEach(() => jobRun.mockReset())

describe("consumption-committed-apply-to-inventory", () => {
  it("listens to the commit workflow's event", () => {
    expect(config.event).toBe("consumption_log.committed")
  })

  it("applies exactly the committed logs, for real, and notes it on the run", async () => {
    jobRun.mockResolvedValue({ summary: "Applied 1 of 1", changes: [{ id: "x" }] })
    const { container, createProductionRunActivities } = makeContainer([
      { id: "log_1", production_run_id: "run_1" },
    ])

    await handler({ event: { data: { log_ids: ["log_1"] } }, container } as any)

    expect(jobRun).toHaveBeenCalledWith(container, {
      dry_run: false,
      params: { log_ids: ["log_1"] },
    })
    expect(createProductionRunActivities).toHaveBeenCalledWith(
      expect.objectContaining({
        production_run_id: "run_1",
        kind: "consumption_applied",
        summary: "Material stock: Applied 1 of 1",
        occurred_at: expect.any(Date),
      })
    )
  })

  it("does nothing without log ids", async () => {
    const { container } = makeContainer([])
    await handler({ event: { data: {} }, container } as any)
    expect(jobRun).not.toHaveBeenCalled()
  })

  it("never lets two applies interleave (absolute level writes would lose one)", async () => {
    let active = 0
    let maxActive = 0
    jobRun.mockImplementation(async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return { summary: "ok", changes: [] }
    })
    const { container } = makeContainer([])

    await Promise.all([
      handler({ event: { data: { log_ids: ["a"] } }, container } as any),
      handler({ event: { data: { log_ids: ["b"] } }, container } as any),
      handler({ event: { data: { log_ids: ["c"] } }, container } as any),
    ])

    expect(jobRun).toHaveBeenCalledTimes(3)
    expect(maxActive).toBe(1)
  })

  it("swallows a failure — the logs stay committed for the job to sweep", async () => {
    jobRun.mockRejectedValue(new Error("boom"))
    const { container, logger } = makeContainer([])
    await expect(
      handler({ event: { data: { log_ids: ["a"] } }, container } as any)
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalled()
  })
})
