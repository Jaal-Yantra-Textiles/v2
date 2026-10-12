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
  /** design↔inventory link rows (Preferred location). */
  designLinks?: Array<Record<string, any>>
  /** location_ownership rows; omit for the brand-store fallback. */
  ownership?: Array<Record<string, any>>
}) => {
  const listLogs = jest.fn(async (filters: Record<string, any>) => {
    const ids: string[] | undefined = filters?.id
    const rows = ids ? opts.logs.filter((l) => ids.includes(l.id)) : opts.logs
    return [rows, rows.length]
  })
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
      if (entity === "design_inventory_item" && opts.designLinks) {
        return { data: opts.designLinks }
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
      if (key === "location_ownership") {
        return {
          listLocationOwnerships: jest.fn().mockResolvedValue(opts.ownership ?? []),
        }
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
        listAndCountConsumptionLogs: listLogs,
        updateConsumptionLogs,
      }
    },
  } as any

  return { container, updateConsumptionLogs, query, listLogs }
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

/**
 * #2406 — where a log draws from. On prod 2026-10-12, 158 committed logs moved
 * no stock: an admin log naming Dharamshala was overruled by a design's
 * Preferred location pointing at the partner's own warehouse, and partner logs
 * stamped with their own warehouse were refused even though that warehouse
 * held none of the cloth.
 */
describe("apply-committed-consumption-to-inventory — location rule (#2406)", () => {
  const OURS = "sloc_dharamshala"
  const PARTNER = "sloc_sharlho"
  const ownership = [
    { stock_location_id: OURS, is_core: true },
    { stock_location_id: PARTNER, is_core: false },
  ]
  const ourLevel = { id: "ilev_ours", inventory_item_id: ITEM, location_id: OURS, stocked_quantity: 20 }

  it("honours a log naming OUR warehouse over a Preferred location that holds none of the cloth", async () => {
    const { container } = makeContainer({
      logs: [committedLog({ quantity: 15, location_id: OURS })],
      levels: [ourLevel],
      ownership,
      designLinks: [{ design_id: "design_1", inventory_item_id: ITEM, location_id: PARTNER }],
    })

    const result = await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.applied).toBe(true)
    const [{ input }] = runInventoryLevels.mock.calls[0]
    expect(input.updates).toEqual([
      { id: "ilev_ours", inventory_item_id: ITEM, location_id: OURS, stocked_quantity: 5 },
    ])
  })

  it("deducts from our stock when a partner's log is stamped with their own warehouse that holds none of it", async () => {
    const { container } = makeContainer({
      logs: [committedLog({ quantity: 1.5, location_id: PARTNER })],
      levels: [ourLevel],
      ownership,
    })

    const result = await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.applied).toBe(true)
    const [{ input }] = runInventoryLevels.mock.calls[0]
    expect(input.updates[0]).toMatchObject({ location_id: OURS, stocked_quantity: 18.5 })
  })

  it("leaves a partner's own cloth alone (it has a level at their warehouse, none at ours)", async () => {
    const { container, updateConsumptionLogs } = makeContainer({
      logs: [committedLog({ quantity: 2, location_id: PARTNER })],
      levels: [{ id: "ilev_theirs", inventory_item_id: ITEM, location_id: PARTNER, stocked_quantity: 9 }],
      ownership,
    })

    const result = await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: {},
    } as any)

    expect(result.applied).toBe(false)
    expect(runInventoryLevels).not.toHaveBeenCalled()
    expect(updateConsumptionLogs).not.toHaveBeenCalled()
  })

  it("log_ids scopes the run to exactly those logs", async () => {
    const { container, listLogs } = makeContainer({
      logs: [
        committedLog({ id: "log_a", quantity: 1, location_id: OURS }),
        committedLog({ id: "log_b", quantity: 4, location_id: OURS }),
      ],
      levels: [ourLevel],
      ownership,
    })

    await applyCommittedConsumptionJob.run(container, {
      dry_run: false,
      params: { log_ids: ["log_a"] },
    } as any)

    expect(listLogs.mock.calls[0][0]).toMatchObject({ id: ["log_a"] })
    const [{ input }] = runInventoryLevels.mock.calls[0]
    expect(input.updates[0].stocked_quantity).toBe(19)
  })
})
