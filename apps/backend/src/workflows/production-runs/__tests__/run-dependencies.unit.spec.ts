/**
 * #1529 — a chain stage may wait on another partner's RUN and on the GOODS
 * being supplied to it, and the two are not the same kind of thing.
 *
 * These cover the rule itself. The thing worth protecting is that "met" is
 * strict in both directions: anything short of completed/delivered, and
 * anything that cannot be read at all, leaves the stage waiting. The failure
 * these guard against is silent — a stage released early looks exactly like a
 * stage released on time, right up until a partner opens a task for cloth that
 * is still on a truck.
 */
import {
  cleanIds,
  describeUnmet,
  hasUnmet,
  resolveUnmetDependencies,
} from "../lib/run-dependencies"

const containerWith = ({
  runs = {},
  orders = {},
}: {
  runs?: Record<string, { status: string } | Error>
  orders?: Record<string, { status: string } | Error>
}) => ({
  resolve: (key: string) => {
    if (key === "production_runs") {
      return {
        retrieveProductionRun: async (id: string) => {
          const row = runs[id]
          if (!row) throw new Error(`no run ${id}`)
          if (row instanceof Error) throw row
          return { id, ...row }
        },
      }
    }
    if (key === "inventory_orders") {
      return {
        retrieveInventoryOrder: async (id: string) => {
          const row = orders[id]
          if (!row) throw new Error(`no order ${id}`)
          if (row instanceof Error) throw row
          return { id, ...row }
        },
      }
    }
    throw new Error(`unexpected module ${key}`)
  },
})

describe("cleanIds", () => {
  it("drops anything that is not a usable id", () => {
    expect(cleanIds(["a", "", null, undefined, 3, "b"])).toEqual(["a", "b"])
    expect(cleanIds(null)).toEqual([])
    expect(cleanIds("inv_1")).toEqual([])
  })
})

describe("resolveUnmetDependencies", () => {
  it("counts a completed run and a delivered order as met", async () => {
    const unmet = await resolveUnmetDependencies(
      containerWith({
        runs: { run_a: { status: "completed" } },
        orders: { inv_a: { status: "Delivered" } },
      }),
      {
        depends_on_run_ids: ["run_a"],
        depends_on_inventory_order_ids: ["inv_a"],
      }
    )

    expect(hasUnmet(unmet)).toBe(false)
  })

  it("holds a stage whose goods are only SHIPPED", async () => {
    // The distinction the whole edge exists for: shipped means the goods left
    // the supplier, not that the partner can start.
    const unmet = await resolveUnmetDependencies(
      containerWith({ orders: { inv_a: { status: "Shipped" } } }),
      { depends_on_inventory_order_ids: ["inv_a"] }
    )

    expect(unmet.inventoryOrders).toEqual(["inv_a"])
    expect(describeUnmet(unmet)).toContain("goods to be delivered")
  })

  it("holds a stage whose upstream run is merely in progress", async () => {
    const unmet = await resolveUnmetDependencies(
      containerWith({ runs: { run_a: { status: "in_progress" } } }),
      { depends_on_run_ids: ["run_a"] }
    )

    expect(unmet.runs).toEqual(["run_a"])
  })

  it("treats a dependency it cannot read as UNMET, never as met", async () => {
    // Falling through as satisfied would release a stage on the strength of a
    // failed lookup — sending a partner work whose materials may not exist.
    const unmet = await resolveUnmetDependencies(
      containerWith({ runs: {}, orders: {} }),
      {
        depends_on_run_ids: ["run_missing"],
        depends_on_inventory_order_ids: ["inv_missing"],
      }
    )

    expect(unmet.runs).toEqual(["run_missing"])
    expect(unmet.inventoryOrders).toEqual(["inv_missing"])
  })

  it("reports BOTH kinds when both are outstanding", async () => {
    const unmet = await resolveUnmetDependencies(
      containerWith({
        runs: { run_a: { status: "approved" } },
        orders: { inv_a: { status: "Pending" } },
      }),
      {
        depends_on_run_ids: ["run_a"],
        depends_on_inventory_order_ids: ["inv_a"],
      }
    )

    const described = describeUnmet(unmet)
    expect(described).toContain("run_a")
    expect(described).toContain("inv_a")
  })

  it("asks nothing of either module when the run has no edges", async () => {
    const container = {
      resolve: () => {
        throw new Error("should not resolve any module")
      },
    }

    const unmet = await resolveUnmetDependencies(container, {})
    expect(hasUnmet(unmet)).toBe(false)
  })
})
