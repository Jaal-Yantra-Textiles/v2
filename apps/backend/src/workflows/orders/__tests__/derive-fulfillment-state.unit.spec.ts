import { deriveFulfillmentState } from "../shiprocket-attach-awb"

/**
 * #437 — auto-sync mapping from a Shiprocket tracking status onto a coarse
 * fulfillment state. Codes mirror the carrier client's scanTypeForStatus.
 */
describe("deriveFulfillmentState (#437)", () => {
  it("maps Shiprocket status codes", () => {
    expect(deriveFulfillmentState(7)).toBe("delivered")
    expect(deriveFulfillmentState(6)).toBe("shipped")
    expect(deriveFulfillmentState(42)).toBe("shipped")
    // created / not-yet-shipped codes stay pending
    expect(deriveFulfillmentState(1)).toBe("pending")
    expect(deriveFulfillmentState(5)).toBe("pending")
  })

  it("falls back to the status text when no code is present", () => {
    expect(deriveFulfillmentState(undefined, "Delivered")).toBe("delivered")
    expect(deriveFulfillmentState(undefined, "In Transit")).toBe("shipped")
    expect(deriveFulfillmentState(undefined, "Out for Delivery")).toBe("shipped")
    expect(deriveFulfillmentState(undefined, "Picked Up")).toBe("shipped")
    // not yet in transit → conservative pending (no status change)
    expect(deriveFulfillmentState(undefined, "Pickup Scheduled")).toBe("pending")
  })

  it("defaults to pending for unknown / empty status", () => {
    expect(deriveFulfillmentState(undefined, undefined)).toBe("pending")
    expect(deriveFulfillmentState(undefined, "")).toBe("pending")
    expect(deriveFulfillmentState(999, "Some New Status")).toBe("pending")
  })

  it("prefers the code over the text", () => {
    // delivered code wins even if text is stale/ambiguous
    expect(deriveFulfillmentState(7, "In Transit")).toBe("delivered")
  })
})
