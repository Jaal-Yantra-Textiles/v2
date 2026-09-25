import { orderHref, workOrderHref } from "../work-order-href"

describe("workOrderHref (#2264)", () => {
  it("a customer sale has no work-order page", () => {
    expect(workOrderHref({ id: "order_R", production_runs: [], inventory_orders: null })).toBeNull()
    expect(orderHref({ id: "order_R" })).toBe("/orders/order_R")
  })

  it("an inventory work order opens its inventory order — object (mirror) or array (work_order)", () => {
    expect(workOrderHref({ id: "order_I", inventory_orders: { id: "inv_order_1" } })).toBe(
      "/orders/inventory/inv_order_1"
    )
    expect(workOrderHref({ id: "order_I", inventory_orders: [{ id: "inv_order_1" }] })).toBe(
      "/orders/inventory/inv_order_1"
    )
  })

  it("a one-run design work order opens its production run", () => {
    expect(workOrderHref({ id: "order_D", production_runs: { id: "prod_run_1" } })).toBe(
      "/production-runs/prod_run_1"
    )
  })

  it("a collated design work order opens Design Work Orders filtered to it", () => {
    const href = "/design-work-orders?id=order_C"
    // work_order: the typed collation
    expect(
      workOrderHref({ id: "order_C", production_runs: [{ id: "a" }], unified_order_kind: { kind: "collated" } })
    ).toBe(href)
    // mirror: the metadata flag (its detail route attaches no sidecar)
    expect(
      workOrderHref({ id: "order_C", production_runs: [{ id: "a" }], metadata: { collated_design_order: true } })
    ).toBe(href)
    // several runs are collated whatever the flag says
    expect(workOrderHref({ id: "order_C", production_runs: [{ id: "a" }, { id: "b" }] })).toBe(href)
  })

  it("an explicit per_run sidecar beats a stale metadata flag", () => {
    expect(
      workOrderHref({
        id: "order_D",
        production_runs: [{ id: "prod_run_1" }],
        unified_order_kind: { kind: "per_run" },
        metadata: { collated_design_order: true },
      })
    ).toBe("/production-runs/prod_run_1")
  })
})
