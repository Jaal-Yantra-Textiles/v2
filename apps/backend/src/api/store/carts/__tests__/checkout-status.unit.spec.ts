// Imports the pure helper from under the [id] route dir. The test file itself
// lives outside any [bracket] dir so it stays runnable with --testPathPattern
// (bracket dirs are interpreted as regex by jest path matching).
import { deriveCheckoutStatus } from "../[id]/checkout-status/lib"

describe("deriveCheckoutStatus", () => {
  it("is completed when an order id is linked", () => {
    expect(deriveCheckoutStatus({ completed_at: null }, "order_1")).toEqual({
      status: "completed",
      order_id: "order_1",
      completed_at: null,
    })
  })

  it("is completed when the cart has completed_at even without a resolved order id", () => {
    const out = deriveCheckoutStatus({ completed_at: "2026-06-28T10:00:00.000Z" }, null)
    expect(out.status).toBe("completed")
    expect(out.completed_at).toBe("2026-06-28T10:00:00.000Z")
    expect(out.order_id).toBeNull()
  })

  it("normalizes a Date completed_at to ISO", () => {
    const d = new Date("2026-06-28T10:00:00.000Z")
    expect(deriveCheckoutStatus({ completed_at: d }, "order_2").completed_at).toBe(
      "2026-06-28T10:00:00.000Z"
    )
  })

  it("is pending for an untouched cart", () => {
    expect(deriveCheckoutStatus({ completed_at: null }, null)).toEqual({
      status: "pending",
      order_id: null,
      completed_at: null,
    })
  })

  it("is pending for a null/missing cart", () => {
    expect(deriveCheckoutStatus(null, undefined).status).toBe("pending")
  })
})
