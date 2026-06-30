import {
  INVENTORY_ORDER_STATUS,
  INVENTORY_ORDER_STATUS_INPUT,
  INVENTORY_ORDER_SYSTEM_STATUS,
} from "../constants"

describe("inventory-order status constants (#778 H8)", () => {
  it("includes Partial in the canonical (queryable) status set", () => {
    expect(INVENTORY_ORDER_STATUS).toContain("Partial")
  })

  it("treats Partial as system-set only — excluded from create/update input", () => {
    expect(INVENTORY_ORDER_SYSTEM_STATUS).toContain("Partial")
    expect(INVENTORY_ORDER_STATUS_INPUT).not.toContain("Partial")
  })

  it("input set = canonical set minus the system-only statuses", () => {
    const expected = INVENTORY_ORDER_STATUS.filter(
      (s) => !(INVENTORY_ORDER_SYSTEM_STATUS as readonly string[]).includes(s)
    )
    expect(INVENTORY_ORDER_STATUS_INPUT).toEqual(expected)
  })

  it("keeps the canonical set aligned with the DB enum on models/order.ts", () => {
    // The model enum is the source the DB CHECK is built from; the canonical
    // list must be a superset/equal so a stored status is always recognised.
    const modelEnum = [
      "Pending",
      "Processing",
      "Ready for Delivery",
      "Shipped",
      "Delivered",
      "Cancelled",
      "Partial",
    ]
    for (const s of modelEnum) {
      expect(INVENTORY_ORDER_STATUS).toContain(s)
    }
  })
})
