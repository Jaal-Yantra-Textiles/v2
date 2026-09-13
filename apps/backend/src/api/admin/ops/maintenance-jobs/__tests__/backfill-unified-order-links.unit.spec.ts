import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { MAINTENANCE_JOBS } from "../registry"
// File-based jobs are imported by the registry but not re-exported from it
// (only the ones defined inline there are), so take it from its own module.
import { backfillUnifiedOrderLinksJob } from "../backfill-unified-order-links-job"

type Row = { id: string; order?: { id: string } | null; metadata?: any }

const makeContainer = (
  rowsByEntity: Record<string, Row[]>,
  liveOrderIds: string[],
  linkCreate: jest.Mock
) => ({
  resolve: (key: string) => {
    if (key === ContainerRegistrationKeys.LINK) return { create: linkCreate }
    return {
      graph: async ({ entity, filters, pagination }: any) => {
        if (entity === "order") {
          return { data: liveOrderIds.filter((id) => filters.id.includes(id)).map((id) => ({ id })) }
        }
        // One page then empty, so the paging loop terminates.
        if ((pagination?.skip ?? 0) > 0) return { data: [] }
        return { data: rowsByEntity[entity] ?? [] }
      },
    }
  },
})

const run = (container: any, dry_run: boolean, params: any = {}) =>
  backfillUnifiedOrderLinksJob.run(container as any, { dry_run, params } as any)

describe("backfill-unified-order-links job", () => {
  it("is registered so Ops/MCP can reach it — the whole point of the job", () => {
    // It existed only as an ops-run `medusa exec`, which is why #2026 could not
    // find out whether it had ever run.
    expect(MAINTENANCE_JOBS.some((j: any) => j.id === "backfill-unified-order-links")).toBe(true)
  })

  it("links a row that has only the metadata backref", async () => {
    const create = jest.fn().mockResolvedValue(undefined)
    const res = await run(
      makeContainer(
        {
          production_runs: [{ id: "run_1", order: null, metadata: { unified_order_id: "order_1" } }],
          inventory_orders: [],
        },
        ["order_1"],
        create
      ),
      false
    )

    expect(create).toHaveBeenCalledTimes(1)
    // Assert the payload AFTER the call, on mock.calls — an expect() thrown
    // inside a mock is swallowed by the job's own try/catch.
    expect(create.mock.calls[0][0]).toEqual([
      {
        [Modules.ORDER]: { order_id: "order_1" },
        production_runs: { production_runs_id: "run_1" },
      },
    ])
    expect(res.changes).toHaveLength(1)
    expect(res.applied).toBe(true)
  })

  it("writes NOTHING on a dry run but still reports what it would do", async () => {
    const create = jest.fn()
    const res = await run(
      makeContainer(
        {
          production_runs: [{ id: "run_1", order: null, metadata: { unified_order_id: "order_1" } }],
          inventory_orders: [],
        },
        ["order_1"],
        create
      ),
      true
    )
    expect(create).not.toHaveBeenCalled()
    expect(res.changes).toHaveLength(1)
    expect(res.applied).toBe(false)
    expect(res.dry_run).toBe(true)
  })

  it("REFUSES a dangling backref rather than linking to a deleted order", async () => {
    // A link to a missing order is worse than no link: every reader treats link
    // presence as the authoritative pointer.
    const create = jest.fn()
    const res = await run(
      makeContainer(
        {
          production_runs: [{ id: "run_x", order: null, metadata: { unified_order_id: "order_gone" } }],
          inventory_orders: [],
        },
        [],
        create
      ),
      false
    )
    expect(create).not.toHaveBeenCalled()
    expect(res.changes).toHaveLength(0)
    expect(res.errors?.[0]?.message).toMatch(/not found/i)
    expect(res.summary).toMatch(/1 dangling/)
  })

  it("skips rows that already resolve the link, and rows with no backref", async () => {
    const create = jest.fn()
    const res = await run(
      makeContainer(
        {
          production_runs: [
            { id: "run_linked", order: { id: "order_1" }, metadata: {} },
            { id: "run_legacy", order: null, metadata: {} },
          ],
          inventory_orders: [],
        },
        ["order_1"],
        create
      ),
      false
    )
    expect(create).not.toHaveBeenCalled()
    expect(res.changes).toHaveLength(0)
    expect(res.summary).toMatch(/1 already linked/)
    expect(res.summary).toMatch(/1 with no backref/)
  })

  it("treats an already-exists link error as success, not failure", async () => {
    // A race or a partial prior run reaches the desired end state.
    const create = jest.fn().mockRejectedValue(new Error("link already exists"))
    const res = await run(
      makeContainer(
        {
          production_runs: [{ id: "run_1", order: null, metadata: { unified_order_id: "order_1" } }],
          inventory_orders: [],
        },
        ["order_1"],
        create
      ),
      false
    )
    expect(res.errors).toHaveLength(0)
    expect(res.changes).toHaveLength(0)
  })

  it("reports a genuine link failure instead of swallowing it", async () => {
    const create = jest.fn().mockRejectedValue(new Error("connection reset"))
    const res = await run(
      makeContainer(
        {
          production_runs: [{ id: "run_1", order: null, metadata: { unified_order_id: "order_1" } }],
          inventory_orders: [],
        },
        ["order_1"],
        create
      ),
      false
    )
    expect(res.errors?.[0]).toMatchObject({ id: "run_1", message: "connection reset" })
    expect(res.changes).toHaveLength(0)
  })

  it("scopes to one entity when asked", async () => {
    const create = jest.fn().mockResolvedValue(undefined)
    const res = await run(
      makeContainer(
        {
          production_runs: [{ id: "run_1", order: null, metadata: { unified_order_id: "order_1" } }],
          inventory_orders: [{ id: "inv_1", order: null, metadata: { unified_order_id: "order_1" } }],
        },
        ["order_1"],
        create
      ),
      false,
      { entity: "inventory_orders" }
    )
    expect(res.changes.map((c: any) => c.id)).toEqual(["inv_1"])
  })
})
