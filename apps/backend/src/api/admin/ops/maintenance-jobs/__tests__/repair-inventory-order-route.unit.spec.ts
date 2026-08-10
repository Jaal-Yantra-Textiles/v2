import { planRouteRepair } from "../repair-inventory-order-route-job"

/**
 * repair-inventory-order-route planner. Pure: no container/DB.
 *
 * The scenario behind it: `inv_order_01KVCT5Z…` stored its ends reversed —
 * from=Dharamshala (ours) / to=Shramdaan (the weaver) for 17.6 m of fabric that
 * was woven at Shramdaan and delivered to Dharamshala. Delivery posted the
 * stock at the reversed destination, so the material never showed up in our own
 * warehouse. `repair-inventory-order-source` cannot fix this: a reversal is
 * precisely the case where the correct source IS the current destination, which
 * that job blocks on.
 */
describe("planRouteRepair", () => {
  const base = {
    orderId: "inv_order_1",
    current: { fromId: "sloc_ours", toId: "sloc_weaver" },
    target: { fromId: "sloc_weaver", toId: "sloc_ours" },
  }

  it("plans both ends for a reversed order", () => {
    const { changes, blocker } = planRouteRepair(base)
    expect(blocker).toBeUndefined()
    expect(changes).toEqual([
      {
        entity: "inventory_order",
        id: "inv_order_1",
        field: "from_stock_location (link)",
        before: "sloc_ours",
        after: "sloc_weaver",
      },
      {
        entity: "inventory_order",
        id: "inv_order_1",
        field: "to_stock_location (link)",
        before: "sloc_weaver",
        after: "sloc_ours",
      },
    ])
  })

  it("is a no-op when the route already points the right way", () => {
    const { changes, blocker } = planRouteRepair({
      ...base,
      current: { fromId: "sloc_weaver", toId: "sloc_ours" },
    })
    expect(blocker).toBeUndefined()
    expect(changes).toEqual([])
  })

  it("plans only the end that moved", () => {
    const { changes } = planRouteRepair({
      ...base,
      current: { fromId: "sloc_weaver", toId: "sloc_wrong" },
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe("to_stock_location (link)")
  })

  it("blocks when source and destination are the same location", () => {
    const { changes, blocker } = planRouteRepair({
      ...base,
      target: { fromId: "sloc_ours", toId: "sloc_ours" },
    })
    expect(changes).toEqual([])
    expect(blocker).toMatch(/originate at its own destination/)
  })

  it("blocks when the order is missing an end and none was supplied", () => {
    const { changes, blocker } = planRouteRepair({
      ...base,
      current: { fromId: "sloc_ours", toId: null },
      target: { fromId: "sloc_ours", toId: null },
    })
    expect(changes).toEqual([])
    expect(blocker).toMatch(/missing one end/)
  })

  it("syncs the unified-order display mirror to the target source", () => {
    const { changes } = planRouteRepair({
      ...base,
      unified: { id: "order_1", fromInMetadata: "sloc_ours" },
    })
    const mirror = changes.find(
      (c) => c.field === "metadata.from_stock_location_id"
    )
    expect(mirror).toEqual({
      entity: "order",
      id: "order_1",
      field: "metadata.from_stock_location_id",
      before: "sloc_ours",
      after: "sloc_weaver",
    })
  })

  it("converges the mirror on a re-run after a partial apply", () => {
    // Links already fixed, mirror still stale — the mirror is compared against
    // the TARGET, not the current link, so the re-run still plans it.
    const { changes } = planRouteRepair({
      ...base,
      current: { fromId: "sloc_weaver", toId: "sloc_ours" },
      unified: { id: "order_1", fromInMetadata: "sloc_ours" },
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe("metadata.from_stock_location_id")
  })
})
