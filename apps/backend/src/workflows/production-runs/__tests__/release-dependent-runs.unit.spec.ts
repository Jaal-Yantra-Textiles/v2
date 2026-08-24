/**
 * #1529 — advancing a chain one hop.
 *
 * The regression that matters here is the one the old cascade had: it dispatched
 * a dependent run only when `dispatch_template_names` was set, so every chain
 * approved the PREFERRED way — by template id, since a name may identify two
 * different process steps (#1261) — stalled at each hop behind a single
 * `logger.info`. Nothing failed, nothing was queued, and the run sat in
 * `approved` looking dispatched-any-moment-now.
 */
const runMock = jest.fn()

jest.mock("../send-production-run-to-production", () => ({
  sendProductionRunToProductionWorkflow: () => ({ run: runMock }),
}))

import {
  releaseRunIfReady,
  findRunsAwaitingInventoryOrder,
} from "../lib/release-dependent-runs"

const metContainer = {
  resolve: (key: string) => {
    if (key === "inventory_orders") {
      return {
        retrieveInventoryOrder: async (id: string) => ({
          id,
          status: "Delivered",
        }),
      }
    }
    if (key === "production_runs") {
      return {
        retrieveProductionRun: async (id: string) => ({
          id,
          status: "completed",
        }),
      }
    }
    throw new Error(`unexpected module ${key}`)
  },
}

beforeEach(() => {
  runMock.mockReset()
  runMock.mockResolvedValue({ result: {} })
})

describe("releaseRunIfReady", () => {
  it("dispatches by ID when the approval recorded ids — the old cascade could not", async () => {
    const outcome = await releaseRunIfReady(metContainer, {
      id: "run_b",
      dispatch_template_ids: ["tpl_a"],
      depends_on_inventory_order_ids: ["inv_a"],
    })

    expect(outcome).toEqual({ run_id: "run_b", result: "dispatched" })
    expect(runMock).toHaveBeenCalledWith({
      input: { production_run_id: "run_b", template_ids: ["tpl_a"] },
    })
  })

  it("still dispatches by name when that is all the approval recorded", async () => {
    await releaseRunIfReady(metContainer, {
      id: "run_b",
      dispatch_template_names: ["Stitching"],
    })

    expect(runMock).toHaveBeenCalledWith({
      input: { production_run_id: "run_b", template_names: ["Stitching"] },
    })
  })

  it("does not dispatch while an upstream edge is outstanding", async () => {
    const container = {
      resolve: () => ({
        retrieveInventoryOrder: async (id: string) => ({ id, status: "Shipped" }),
      }),
    }

    const outcome = await releaseRunIfReady(container, {
      id: "run_b",
      dispatch_template_ids: ["tpl_a"],
      depends_on_inventory_order_ids: ["inv_a"],
    })

    expect(outcome.result).toBe("waiting")
    expect(runMock).not.toHaveBeenCalled()
  })

  it("reports a run with no template selection rather than inventing one", async () => {
    const outcome = await releaseRunIfReady(metContainer, { id: "run_b" })

    expect(outcome.result).toBe("no_templates")
    expect(runMock).not.toHaveBeenCalled()
  })

  it("carries a dispatch failure back instead of throwing at the event bus", async () => {
    runMock.mockRejectedValueOnce(new Error("Ambiguous task template name(s)"))

    const outcome = await releaseRunIfReady(metContainer, {
      id: "run_b",
      dispatch_template_names: ["Stitching"],
    })

    expect(outcome).toMatchObject({
      run_id: "run_b",
      result: "failed",
      message: expect.stringContaining("Ambiguous"),
    })
  })
})

describe("findRunsAwaitingInventoryOrder", () => {
  it("matches only approved runs that name this order", async () => {
    const rows = [
      { id: "run_a", depends_on_inventory_order_ids: ["inv_a"] },
      { id: "run_b", depends_on_inventory_order_ids: ["inv_other"] },
      { id: "run_c", depends_on_inventory_order_ids: null },
      { id: "run_d", depends_on_inventory_order_ids: ["inv_other", "inv_a"] },
    ]

    const listProductionRuns = jest.fn().mockResolvedValue(rows)
    const container = { resolve: () => ({ listProductionRuns }) }

    const found = await findRunsAwaitingInventoryOrder(container, "inv_a")

    expect(found.map((r: any) => r.id)).toEqual(["run_a", "run_d"])
    // Candidates are narrowed to `approved` in the query, not in memory — a run
    // already dispatched must never be dispatched a second time.
    expect(listProductionRuns).toHaveBeenCalledWith({ status: "approved" })
  })
})
