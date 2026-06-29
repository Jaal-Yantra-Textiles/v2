import {
  buildStatusChangedEvent,
  INVENTORY_ORDER_STATUS_CHANGED_EVENT,
} from "../update-inventory-order"

describe("buildStatusChangedEvent (#771)", () => {
  it("emits when a status change was intended and the value actually moved", () => {
    const ev = buildStatusChangedEvent("io_1", "Pending", "Processing", true)
    expect(ev).toEqual({
      name: INVENTORY_ORDER_STATUS_CHANGED_EVENT,
      data: { id: "io_1", previous_status: "Pending", status: "Processing" },
    })
  })

  it("normalizes a missing previous status to null", () => {
    const ev = buildStatusChangedEvent("io_1", undefined, "Shipped", true)
    expect(ev?.data).toEqual({ id: "io_1", previous_status: null, status: "Shipped" })
  })

  it("no-ops when no status change was intended (metadata-only update)", () => {
    expect(buildStatusChangedEvent("io_1", "Processing", "Processing", false)).toBeNull()
  })

  it("no-ops when the status did not actually change", () => {
    expect(buildStatusChangedEvent("io_1", "Processing", "Processing", true)).toBeNull()
  })

  it("no-ops when the new status is missing", () => {
    expect(buildStatusChangedEvent("io_1", "Processing", undefined, true)).toBeNull()
    expect(buildStatusChangedEvent("io_1", "Processing", null, true)).toBeNull()
  })
})
