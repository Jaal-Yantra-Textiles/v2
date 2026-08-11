const runInventoryLevels = jest.fn().mockResolvedValue({ result: [] })

jest.mock("@medusajs/medusa/core-flows", () => ({
  updateInventoryLevelsWorkflow: jest.fn(() => ({ run: runInventoryLevels })),
}))

import { applyCommittedConsumptionJob } from "../apply-committed-consumption-job"

/**
 * #1248 — the container-bound half of `apply-committed-consumption-to-inventory`.
 *
 * The planner is covered exhaustively in
 * `workflows/consumption-logs/__tests__/apply-to-inventory.unit.spec.ts`, and
 * only the planner was — which is how the first prod apply died with
 * `Item undefined is not stocked at location undefined`. The job handed
 * `updateInventoryLevelsWorkflow` just `{ id, stocked_quantity }`, but
 * `updateInventoryLevels_` ignores `id` and re-resolves the level from
 * `(inventory_item_id, location_id)`. A dry-run never reaches that call, so the
 * defect was invisible until the apply.
 *
 * These tests drive `run()` against a fake container so the WRITE SHAPE itself
 * is asserted, not just the arithmetic that decides it.
 */

const BRAND_LOC = "sloc_brand"
const ITEM = "iitem_1"
const LEVEL = "iilev_1"

type Log = Record<string, any>

const makeContainer = (opts: {
  logs: Log[]
  levels?: Array<Record<string, any>>
  runs?: Array<Record<string, any>>
}) => {
  const updateConsumptionLogs = jest.fn().mockResolvedValue(undefined)
  const linkCreate = jest.fn().mockResolvedValue(undefined)
  const linkDismiss = jest.fn().mockResolvedValue(undefined)

  const levels = opts.levels ?? [
    {
      id: LEVEL,
      inventory_item_id: ITEM,
      location_id: BRAND_LOC,
      stocked_quantity: 10,
    },
  ]

  const query = {
    graph: jest.fn(async ({ entity }: { entity: string }) => {
      if (entity === "inventory_level") {
        return { data: levels }
      }
      // design↔inventory link mirror — absent here, so the job skips it.
      return { data: [] }
    }),
  }

  const container = {
    resolve: (key: string) => {
      if (key === "query") return query
      if (key === "link" || key === "remoteLink") {
        return { create: linkCreate, dismiss: linkDismiss }
      }
      if (key === "production_runs") {
        return {
          listAndCountProductionRuns: jest
            .fn()
            .mockResolvedValue([opts.runs ?? [], (opts.runs ?? []).length]),
        }
      }
      // consumption_log
      return {
        listAndCountConsumptionLogs: jest
          .fn()
          .mockResolvedValue([opts.logs, opts.logs.length]),
        updateConsumptionLogs,
      }
    },
  } as any

  return { container, updateConsumptionLogs, query }
}

const committedLog = (over: Log = {}): Log => ({
  id: "log_1",
  design_id: "design_1",
  production_run_id: null,
  quantity_basis: "total",
  inventory_item_id: ITEM,
  quantity: 2,
  is_committed: true,
  location_id: null,
  metadata: null,
  ...over,
})

beforeEach(() => {
  runInventoryLevels.mockClear()
})

describe("apply-committed-consumption-to-inventory — level update shape", () => {
  it("sends inventory_item_id and location_id, not just the level id", async () => {
    const { container } = makeContainer({ logs: [committedLog()] })

    const result = await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: { location_id: BRAND_LOC },
    } as any)

    expect(result.applied).toBe(true)
    expect(runInventoryLevels).toHaveBeenCalledTimes(1)

    const [{ input }] = runInventoryLevels.mock.calls[0]
    expect(input.updates).toEqual([
      {
        id: LEVEL,
        inventory_item_id: ITEM,
        location_id: BRAND_LOC,
        stocked_quantity: 8,
      },
    ])
  })

  it("never emits an update missing the item/location pair", async () => {
    const { container } = makeContainer({
      logs: [
        committedLog({ id: "log_1", quantity: 2 }),
        committedLog({ id: "log_2", quantity: 3 }),
      ],
    })

    await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: { location_id: BRAND_LOC },
    } as any)

    const [{ input }] = runInventoryLevels.mock.calls[0]
    for (const u of input.updates) {
      expect(typeof u.inventory_item_id).toBe("string")
      expect(typeof u.location_id).toBe("string")
      expect(u.inventory_item_id).not.toBeUndefined()
      expect(u.location_id).not.toBeUndefined()
    }
    // Two logs on one item collapse to a single carried-forward level write.
    expect(input.updates).toHaveLength(1)
    expect(input.updates[0].stocked_quantity).toBe(5)
  })

  it("writes nothing at all on a dry run", async () => {
    const { container, updateConsumptionLogs } = makeContainer({
      logs: [committedLog()],
    })

    const result = await applyCommittedConsumptionJob.run(container, {
      dry_run: true,
      params: { location_id: BRAND_LOC },
    } as any)

    expect(result.applied).toBe(false)
    expect(result.changes).toHaveLength(1)
    expect(runInventoryLevels).not.toHaveBeenCalled()
    expect(updateConsumptionLogs).not.toHaveBeenCalled()
  })

  it("stamps every applied log so a re-run cannot double-deduct", async () => {
    const { container, updateConsumptionLogs } = makeContainer({
      logs: [committedLog({ metadata: { committed_at: "2026-07-17" } })],
    })

    await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: { location_id: BRAND_LOC },
    } as any)

    expect(updateConsumptionLogs).toHaveBeenCalledTimes(1)
    const stamped = updateConsumptionLogs.mock.calls[0][0]
    expect(stamped.id).toBe("log_1")
    // the pre-existing metadata survives the stamp
    expect(stamped.metadata.committed_at).toBe("2026-07-17")
    expect(stamped.metadata.inventory_applied_at).toEqual(expect.any(String))
    expect(stamped.metadata.inventory_applied_location_id).toBe(BRAND_LOC)
  })

  it("does not touch inventory when every log is skipped", async () => {
    // No level at the brand location ⇒ partner-held ⇒ skip.
    const { container, updateConsumptionLogs } = makeContainer({
      logs: [committedLog()],
      levels: [],
    })

    const result = await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: { location_id: BRAND_LOC },
    } as any)

    expect(result.applied).toBe(false)
    expect(runInventoryLevels).not.toHaveBeenCalled()
    expect(updateConsumptionLogs).not.toHaveBeenCalled()
    expect(result.summary).toMatch(/Skipped/)
  })
})
