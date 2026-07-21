import { resolveFulfillmentSyncAction } from "../sync-order-shipment-tracking"

/**
 * #1111 — core-order tracking webhook forward-only guard. Pure decision: given
 * the carrier-derived coarse state and the fulfillment's shipped/delivered/
 * canceled timestamps, what should the webhook do? Idempotent + never regresses.
 */
describe("resolveFulfillmentSyncAction", () => {
  const T = "2026-07-21T00:00:00.000Z"

  it("ships a fresh fulfillment on a shipped signal", () => {
    expect(resolveFulfillmentSyncAction("shipped", {})).toBe("ship")
    expect(resolveFulfillmentSyncAction("shipped", { shipped_at: null })).toBe("ship")
  })

  it("ships+delivers a fresh fulfillment on a delivered signal (skips the intermediate)", () => {
    expect(resolveFulfillmentSyncAction("delivered", {})).toBe("ship_and_deliver")
  })

  it("only delivers when already shipped", () => {
    expect(resolveFulfillmentSyncAction("delivered", { shipped_at: T })).toBe("deliver")
  })

  it("is idempotent — no-ops when already in the target state", () => {
    expect(resolveFulfillmentSyncAction("shipped", { shipped_at: T })).toBe("none")
    expect(resolveFulfillmentSyncAction("delivered", { shipped_at: T, delivered_at: T })).toBe("none")
  })

  it("never regresses a delivered fulfillment on a later shipped/pending push", () => {
    expect(resolveFulfillmentSyncAction("shipped", { shipped_at: T, delivered_at: T })).toBe("none")
    expect(resolveFulfillmentSyncAction("pending", { shipped_at: T, delivered_at: T })).toBe("none")
  })

  it("never touches a canceled fulfillment", () => {
    expect(resolveFulfillmentSyncAction("shipped", { canceled_at: T })).toBe("none")
    expect(resolveFulfillmentSyncAction("delivered", { canceled_at: T })).toBe("none")
    expect(resolveFulfillmentSyncAction("delivered", { shipped_at: T, canceled_at: T })).toBe("none")
  })

  it("does nothing on a pre-pickup / unknown (pending) push", () => {
    expect(resolveFulfillmentSyncAction("pending", {})).toBe("none")
    expect(resolveFulfillmentSyncAction("pending", { shipped_at: T })).toBe("none")
  })
})
