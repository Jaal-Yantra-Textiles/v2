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


/**
 * #2202 — the standing answer, and the fence around it.
 *
 * These runs were born `approved` from `order.placed` and can never be approved
 * (approval mints a child sharing `order_line_item_id`, which collides with the
 * partial unique index), so they can never carry templates. Before this, their
 * cloth arriving produced one `logger.info` and silence.
 */
describe("releaseRunIfReady — dispatch defaults (#2202)", () => {
  const STITCH = "tpl_stitch"

  /** A container that can answer the policy and the design, like prod's. */
  const containerWith = (
    dispatchDefaults: any,
    design: any = { id: "design_1", product_type: "robe" }
  ) => ({
    resolve: (key: string) => {
      if (key === "inventory_orders") {
        return {
          retrieveInventoryOrder: async (id: string) => ({ id, status: "Delivered" }),
        }
      }
      if (key === "production_runs") {
        return { retrieveProductionRun: async (id: string) => ({ id, status: "completed" }) }
      }
      if (key === "production_policy") {
        return { getPolicyConfig: async () => ({ dispatch_defaults: dispatchDefaults }) }
      }
      if (key === "query") {
        return { graph: async () => ({ data: design ? [design] : [] }) }
      }
      throw new Error(`unexpected module ${key}`)
    },
  })

  it("dispatches from the policy when nobody chose, and SAYS it was a default", async () => {
    const outcome = await releaseRunIfReady(
      containerWith([
        { when: { run_type: "production", product_type: "robe" }, template_ids: [STITCH] },
      ]),
      {
        id: "run_oshen",
        run_type: "production",
        design_id: "design_1",
        depends_on_inventory_order_ids: ["inv_a"],
      }
    )

    expect(outcome).toEqual({
      run_id: "run_oshen",
      result: "dispatched",
      via: "policy_default",
    })
    expect(runMock).toHaveBeenCalledWith({
      input: { production_run_id: "run_oshen", template_ids: [STITCH] },
    })
  })

  it("an approval's own choice still wins and is NOT marked as a default", async () => {
    const outcome = await releaseRunIfReady(
      containerWith([
        { when: { run_type: "production" }, template_ids: ["tpl_policy"] },
      ]),
      {
        id: "run_b",
        run_type: "production",
        design_id: "design_1",
        dispatch_template_ids: ["tpl_chosen"],
      }
    )

    expect(outcome).toEqual({ run_id: "run_b", result: "dispatched" })
    expect(runMock).toHaveBeenCalledWith({
      input: { production_run_id: "run_b", template_ids: ["tpl_chosen"] },
    })
  })

  it("🔴 does NOT dispatch while a dependency is outstanding, policy or not", async () => {
    /*
     * The fence. A standing rule answers "what with", never "whether". If this
     * ever inverts, a partner is commissioned for cloth that has not arrived.
     */
    const container = {
      resolve: (key: string) => {
        if (key === "inventory_orders") {
          return {
            retrieveInventoryOrder: async (id: string) => ({ id, status: "Shipped" }),
          }
        }
        if (key === "production_policy") {
          return {
            getPolicyConfig: async () => ({
              dispatch_defaults: [
                { when: { run_type: "production" }, template_ids: [STITCH] },
              ],
            }),
          }
        }
        if (key === "query") {
          return { graph: async () => ({ data: [{ id: "design_1", product_type: "robe" }] }) }
        }
        throw new Error(`unexpected module ${key}`)
      },
    }

    const outcome = await releaseRunIfReady(container, {
      id: "run_oshen",
      run_type: "production",
      design_id: "design_1",
      depends_on_inventory_order_ids: ["inv_a"],
    })

    expect(outcome.result).toBe("waiting")
    expect(runMock).not.toHaveBeenCalled()
  })

  it("still reports no_templates when no rule matches this job", async () => {
    const outcome = await releaseRunIfReady(
      containerWith([{ when: { run_type: "sample" }, template_ids: [STITCH] }]),
      { id: "run_oshen", run_type: "production", design_id: "design_1" }
    )

    expect(outcome.result).toBe("no_templates")
    expect(runMock).not.toHaveBeenCalled()
  })

  it("matches on run_type alone when the design cannot be read", async () => {
    const outcome = await releaseRunIfReady(
      containerWith(
        [{ when: { run_type: "production" }, template_ids: [STITCH] }],
        null
      ),
      { id: "run_oshen", run_type: "production", design_id: "design_1" }
    )

    expect(outcome).toMatchObject({ result: "dispatched", via: "policy_default" })
  })

  it("fails SAFE when the policy cannot be read at all", async () => {
    /*
     * The policy read is the last step before a partner is messaged. A module
     * that throws must leave the run un-dispatched and tellable, never take the
     * caller down and never dispatch on a half-read config.
     */
    const exploding = {
      resolve: (key: string) => {
        if (key === "production_policy") throw new Error("module down")
        if (key === "inventory_orders") {
          return {
            retrieveInventoryOrder: async (id: string) => ({ id, status: "Delivered" }),
          }
        }
        throw new Error(`unexpected module ${key}`)
      },
    }

    const outcome = await releaseRunIfReady(exploding, {
      id: "run_oshen",
      run_type: "production",
      depends_on_inventory_order_ids: ["inv_a"],
    })

    expect(outcome.result).toBe("no_templates")
    expect(runMock).not.toHaveBeenCalled()
  })
})
