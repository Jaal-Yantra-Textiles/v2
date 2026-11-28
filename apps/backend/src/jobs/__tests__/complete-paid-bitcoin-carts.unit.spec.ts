import { sweepDecision } from "../complete-paid-bitcoin-carts"

/**
 * The sweep places an order with nobody watching, so it must only fire on a
 * confirmed (Settled) invoice that belongs to THIS session — never on an
 * unconfirmed one, and never on an invoice whose metadata names another session.
 */
const s = { session_id: "payses_1", cart_id: "cart_1", data: { invoice_id: "INV1", amount: "1625.00", currency: "INR", btcpay_store_id: "S1", session_id: "payses_1" } }
const inv = (over: Record<string, any> = {}) => ({
  id: "INV1", storeId: "S1", status: "Settled", additionalStatus: "None", amount: "1625.00", currency: "INR",
  metadata: { medusa_session_id: "payses_1" }, ...over,
})

describe("bitcoin sweep decision", () => {
  it("confirmed (Settled) → place the order", () => {
    expect(sweepDecision(inv(), s, "OURS").complete).toBe(true)
  })
  it("paid but not yet confirmed (Processing) → wait", () => {
    expect(sweepDecision(inv({ status: "Processing" }), s, "OURS").complete).toBe(false)
  })
  it("unpaid, expired, or partially paid → never place", () => {
    for (const o of [{ status: "New" }, { status: "Expired" }, { additionalStatus: "PaidPartial" }, { amount: "10.00" }]) {
      expect(sweepDecision(inv(o), s, "OURS").complete).toBe(false)
    }
  })
  it("judges by the session ROW id, not buyer-writable data.session_id", () => {
    // Buyer rewrote data.session_id to match someone else's settled invoice.
    const forged = { ...s, data: { ...s.data, session_id: "payses_OTHER" } }
    expect(sweepDecision(inv({ metadata: { medusa_session_id: "payses_OTHER" } }), forged, "OURS").complete).toBe(false)
  })
})
