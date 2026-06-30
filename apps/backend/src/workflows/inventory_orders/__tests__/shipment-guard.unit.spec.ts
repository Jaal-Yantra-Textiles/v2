import { isShipmentAllowed, assertShipmentAllowed } from "../lib/shipment-guard"

describe("shipment-guard (#790 slice 2)", () => {
  it("allows shipping from the ready/in-flight states", () => {
    for (const s of ["Processing", "Ready for Delivery", "Partial", "Shipped"]) {
      expect(isShipmentAllowed(s)).toBe(true)
      expect(() => assertShipmentAllowed(s)).not.toThrow()
    }
  })

  it("rejects shipping from Pending / Delivered / Cancelled / unknown", () => {
    for (const s of ["Pending", "Delivered", "Cancelled", "", null, undefined, "Weird"]) {
      expect(isShipmentAllowed(s as any)).toBe(false)
      expect(() => assertShipmentAllowed(s as any)).toThrow(/cannot create a shipment/i)
    }
  })
})
