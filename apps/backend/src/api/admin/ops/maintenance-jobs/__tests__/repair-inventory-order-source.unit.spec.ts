import { planSourceRepair } from "../repair-inventory-order-source-job"

/**
 * #457 — repair-inventory-order-source planner. Pure: no container/DB.
 * The scenario behind it: an order created against a wrong/deleted source
 * location (the "Parmar Mukesh Tangaliya Weave" vs "Tangaliya House"
 * duplicate) with a stale metadata.shipment blob from a mis-assigned
 * shipment attempt.
 */
describe("planSourceRepair", () => {
  const base = {
    orderId: "inv_order_1",
    currentFromId: "sloc_wrong",
    targetFromId: "sloc_right",
    toLocationId: "sloc_dest",
    shipment: null,
    clearStaleShipment: false,
  }

  it("plans a link repoint when the from-location differs", () => {
    const { changes, blocker } = planSourceRepair(base)
    expect(blocker).toBeUndefined()
    expect(changes).toEqual([
      {
        entity: "inventory_order",
        id: "inv_order_1",
        field: "from_stock_location (link)",
        before: "sloc_wrong",
        after: "sloc_right",
      },
    ])
  })

  it("plans the repoint when the order has NO from-link (deleted location)", () => {
    const { changes } = planSourceRepair({ ...base, currentFromId: null })
    expect(changes).toHaveLength(1)
    expect(changes[0].before).toBeNull()
    expect(changes[0].after).toBe("sloc_right")
  })

  it("is a no-op when the link already points at the target", () => {
    const { changes, blocker } = planSourceRepair({
      ...base,
      currentFromId: "sloc_right",
    })
    expect(blocker).toBeUndefined()
    expect(changes).toEqual([])
  })

  it("blocks when the target is the order's destination", () => {
    const { changes, blocker } = planSourceRepair({
      ...base,
      targetFromId: "sloc_dest",
    })
    expect(blocker).toMatch(/destination/)
    expect(changes).toEqual([])
  })

  it("clears a stale shipment blob (empty awb + tracking) when asked", () => {
    const shipment = {
      awb: "",
      tracking_number: "",
      carrier: "shiprocket",
      label_url: "https://x/label.pdf",
      provider_refs: { shipment_id: 1, sr_order_id: 2 },
    }
    const { changes, blocker } = planSourceRepair({
      ...base,
      shipment,
      clearStaleShipment: true,
    })
    expect(blocker).toBeUndefined()
    expect(changes).toHaveLength(2)
    const meta = changes.find((c) => c.field === "metadata.shipment")!
    expect(meta.before).toBe(shipment)
    expect(meta.after).toBeNull()
  })

  it("refuses to clear a shipment blob that carries a real AWB", () => {
    const { changes, blocker } = planSourceRepair({
      ...base,
      shipment: { awb: "AWB123", tracking_number: "" },
      clearStaleShipment: true,
    })
    expect(blocker).toMatch(/real consignment/)
    expect(blocker).toContain("AWB123")
    expect(changes).toEqual([])
  })

  it("refuses to clear a shipment blob that carries a tracking number", () => {
    const { blocker } = planSourceRepair({
      ...base,
      shipment: { tracking_number: "TRK9" },
      clearStaleShipment: true,
    })
    expect(blocker).toMatch(/real consignment/)
  })

  it("ignores clear_stale_shipment when there is no shipment blob", () => {
    const { changes } = planSourceRepair({
      ...base,
      currentFromId: "sloc_right",
      shipment: null,
      clearStaleShipment: true,
    })
    expect(changes).toEqual([])
  })

  it("clears the blob even when the link needs no repoint", () => {
    const { changes } = planSourceRepair({
      ...base,
      currentFromId: "sloc_right",
      shipment: { awb: "", carrier: "shiprocket" },
      clearStaleShipment: true,
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe("metadata.shipment")
  })

  it("does not guard the destination when the order has no to-link", () => {
    const { changes, blocker } = planSourceRepair({
      ...base,
      toLocationId: null,
    })
    expect(blocker).toBeUndefined()
    expect(changes).toHaveLength(1)
  })

  it("syncs a stale unified-order metadata mirror alongside the link", () => {
    const { changes } = planSourceRepair({
      ...base,
      unified: { id: "order_u1", fromInMetadata: "sloc_wrong" },
    })
    expect(changes).toHaveLength(2)
    const mirror = changes.find(
      (c) => c.field === "metadata.from_stock_location_id"
    )!
    expect(mirror.entity).toBe("order")
    expect(mirror.id).toBe("order_u1")
    expect(mirror.before).toBe("sloc_wrong")
    expect(mirror.after).toBe("sloc_right")
  })

  it("converges the mirror even when the link is already correct (re-run after partial apply)", () => {
    const { changes } = planSourceRepair({
      ...base,
      currentFromId: "sloc_right",
      unified: { id: "order_u1", fromInMetadata: "sloc_wrong" },
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].field).toBe("metadata.from_stock_location_id")
  })

  it("leaves an already-synced mirror alone", () => {
    const { changes } = planSourceRepair({
      ...base,
      currentFromId: "sloc_right",
      unified: { id: "order_u1", fromInMetadata: "sloc_right" },
    })
    expect(changes).toEqual([])
  })

  it("handles a mirror with no recorded from (null) as stale", () => {
    const { changes } = planSourceRepair({
      ...base,
      currentFromId: "sloc_right",
      unified: { id: "order_u1", fromInMetadata: null },
    })
    expect(changes).toHaveLength(1)
    expect(changes[0].before).toBeNull()
  })
})
