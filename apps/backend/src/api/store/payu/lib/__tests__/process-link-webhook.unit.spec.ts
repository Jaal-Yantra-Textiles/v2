const completeCart = jest.fn()
jest.mock("../complete-from-external", () => ({
  completeCartFromExternalPayment: (...a: any[]) => completeCart(...a),
}))

import { processPayuLinkWebhook } from "../process-link-webhook"
import { isExtraPayment } from "../../../../../lib/payments/payu-payment-issues"

/**
 * #2572 — a UPI intent cannot be switched off, so money can now arrive that
 * no order can absorb. Each case below must leave a trace a human sees.
 */
const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
const updateCarts = jest.fn()
const createNotifications = jest.fn()

const scopeWith = (cart: any, schedule: any = null) => {
  let metadata = { ...(cart.metadata ?? {}) }
  updateCarts.mockImplementation(async (_id: string, patch: any) => {
    metadata = patch.metadata
  })
  return {
    scope: {
      resolve: (key: string) => {
        if (key === "logger") return logger
        if (key === "query") return { graph: jest.fn(async () => ({ data: [cart] })) }
        if (key === "payment_schedule") return { findByCartId: jest.fn(async () => schedule) }
        if (key === "cart")
          return { listCarts: jest.fn(async () => [{ id: cart.id, metadata }]), updateCarts }
        if (key === "notification") return { createNotifications }
        throw new Error(`unexpected resolve ${key}`)
      },
    },
    metadata: () => metadata,
  }
}

const verified = (status: string, amount: number, paid: boolean) =>
  jest.fn(async () => ({ paid, status, amount, raw: {} }))

beforeEach(() => {
  jest.clearAllMocks()
  delete process.env.PAYU_CLIENT_ID // no OneAPI fallback in these tests
  completeCart.mockResolvedValue({ order_id: "order_1", already_completed: false })
})

describe("processPayuLinkWebhook — #2572 guards", () => {
  it("completes a cart paid in full and stamps the completing txn", async () => {
    const { scope, metadata } = scopeWith({ id: "cart_1", total: 1100, metadata: {} })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiA" },
      { verifyTransaction: verified("success", 1100, true) }
    )
    expect(out).toEqual({ completed: true, order_id: "order_1" })
    expect(metadata().payu_completed_txnid).toBe("upiA")
    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("🔴 records a SHORT payment (old QR after a reprice) instead of dropping it", async () => {
    const { scope, metadata } = scopeWith({ id: "cart_1", total: 1500, metadata: {} })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiOld", mihpayid: "999" },
      { verifyTransaction: verified("success", 1100, false) }
    )
    expect(out).toEqual({ completed: false, order_id: null, reason: "paid_short" })
    expect(completeCart).not.toHaveBeenCalled()
    expect(metadata().payu_payment_issues).toEqual([
      expect.objectContaining({ kind: "short", txnid: "upiOld", paid: 1100, due: 1500 }),
    ])
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("₹1100.00"))
    expect(createNotifications).toHaveBeenCalledTimes(1)
  })

  it("does not record anything for a payment PayU says is NOT successful", async () => {
    const { scope, metadata } = scopeWith({ id: "cart_1", total: 1100, metadata: {} })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiX" },
      { verifyTransaction: verified("pending", 1100, false) }
    )
    expect(out.reason).toBe("not_verified")
    expect(metadata().payu_payment_issues).toBeUndefined()
  })

  it("🔴 flags a second payment on an already-completed cart (link AND QR paid)", async () => {
    const { scope, metadata } = scopeWith({
      id: "cart_1",
      total: 1100,
      completed_at: "2026-11-22T00:00:00Z",
      metadata: { payu_completed_txnid: "linkTxn" },
    })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiB" },
      { verifyTransaction: verified("success", 1100, true) }
    )
    expect(out.reason).toBe("extra_payment")
    expect(completeCart).not.toHaveBeenCalled()
    expect(metadata().payu_payment_issues).toEqual([
      expect.objectContaining({ kind: "extra", txnid: "upiB" }),
    ])
  })

  it("treats a repeat webhook for the completing txn as a no-op, not extra", async () => {
    completeCart.mockResolvedValue({ order_id: "order_1", already_completed: true })
    const { scope, metadata } = scopeWith({
      id: "cart_1",
      total: 1100,
      completed_at: "2026-11-22T00:00:00Z",
      metadata: {},
      // A cart completed before the stamp existed: the session has the txnid.
      payment_collection: { payment_sessions: [{ data: { txnid: "upiA" } }] },
    })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiA" },
      { verifyTransaction: verified("success", 1100, true) }
    )
    expect(out).toEqual({ completed: true, order_id: "order_1" })
    expect(metadata().payu_payment_issues).toBeUndefined()
  })

  it("completes but flags an OVERPAYMENT (old QR after the price went down)", async () => {
    const { scope, metadata } = scopeWith({ id: "cart_1", total: 900, metadata: {} })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiOld" },
      { verifyTransaction: verified("success", 1100, true) }
    )
    expect(out.completed).toBe(true)
    expect(metadata().payu_payment_issues).toEqual([
      expect.objectContaining({ kind: "over", paid: 1100, due: 900 }),
    ])
  })

  /**
   * #2645 — the buyer paid an OLD full-total link/QR after a 50% deposit was
   * set. The cart completes (paid ≥ deposit) and the order records only the
   * deposit, so the balance would be asked for again: the alert must say so.
   */
  it("🔴 a FULL payment on a DEPOSIT cart is flagged as 'do not raise the balance'", async () => {
    const { scope, metadata } = scopeWith(
      { id: "cart_1", total: 25200, metadata: {} },
      {
        id: "psch_1",
        source_type: "manual",
        deposit_status: "pending",
        deposit_pct: 50,
        deposit_amount: 12600,
      }
    )
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "oldLink" },
      { verifyTransaction: verified("success", 25200, true) }
    )
    expect(out.completed).toBe(true)
    expect(metadata().payu_payment_issues).toEqual([
      expect.objectContaining({ kind: "over", paid: 25200, due: 12600, deposit_cart_total: 25200 }),
    ])
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Do NOT raise the balance"))
  })

  it("does not stack the same issue twice on a retried webhook", async () => {
    const { scope, metadata } = scopeWith({ id: "cart_1", total: 1500, metadata: {} })
    const payload = { status: "success", udf1: "cart_1", txnid: "upiOld" }
    const deps = { verifyTransaction: verified("success", 1100, false) }
    await processPayuLinkWebhook(scope, payload, deps)
    await processPayuLinkWebhook(scope, payload, deps)
    expect(metadata().payu_payment_issues).toHaveLength(1)
  })
})

describe("processPayuLinkWebhook — duplicate deliveries (live 2026-11-22)", () => {
  it("🔴 a second delivery of the SAME payment, seen after completion, is not a second payment", async () => {
    // The race seen live: delivery 2 reads the cart already completed by
    // delivery 1, whose txn is on the cart only as a CLAIM (no stamp yet).
    const { scope, metadata } = scopeWith({
      id: "cart_1",
      total: 1.05,
      completed_at: "2026-11-22T07:17:28Z",
      metadata: { payu_claimed_txnids: ["upiA"] },
    })
    completeCart.mockResolvedValue({ order_id: "order_1", already_completed: true })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiA" },
      { verifyTransaction: verified("success", 1.05, true) }
    )
    expect(out.completed).toBe(true)
    expect(metadata().payu_payment_issues).toBeUndefined()
    expect(createNotifications).not.toHaveBeenCalled()
  })

  it("claims the txn on the cart BEFORE completing it", async () => {
    const { scope, metadata } = scopeWith({ id: "cart_1", total: 1100, metadata: {} })
    let claimedAtCompletion: unknown = null
    completeCart.mockImplementation(async () => {
      claimedAtCompletion = metadata().payu_claimed_txnids
      return { order_id: "order_1", already_completed: false }
    })
    await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiA" },
      { verifyTransaction: verified("success", 1100, true) }
    )
    expect(claimedAtCompletion).toEqual(["upiA"])
  })

  it("flags a DIFFERENT payment that lost the race to complete the cart", async () => {
    // Both read an open cart; the other payment completed it first.
    const { scope, metadata } = scopeWith({
      id: "cart_1",
      total: 1100,
      metadata: { payu_claimed_txnids: ["linkTxn"] },
    })
    completeCart.mockResolvedValue({ order_id: "order_1", already_completed: true })
    const out = await processPayuLinkWebhook(
      scope,
      { status: "success", udf1: "cart_1", txnid: "upiB" },
      { verifyTransaction: verified("success", 1100, true) }
    )
    expect(out.reason).toBe("extra_payment")
    expect(metadata().payu_payment_issues).toEqual([
      expect.objectContaining({ kind: "extra", txnid: "upiB" }),
    ])
  })
})

describe("isExtraPayment", () => {
  it("is false for an open cart and for a known txn, true otherwise", () => {
    expect(isExtraPayment({ completedAt: null, knownTxnids: [], txnid: "a" })).toBe(false)
    expect(isExtraPayment({ completedAt: "x", knownTxnids: [undefined, "a"], txnid: "a" })).toBe(false)
    expect(isExtraPayment({ completedAt: "x", knownTxnids: [undefined, null], txnid: "a" })).toBe(true)
  })
})
