import {
  decideCancel,
  decideCustomerAttach,
  decideReprice,
  isCancelled,
  isConverted,
} from "../mutate-design-order"

const openCart = { id: "cart_1", customer_id: null, email: null }
const buyer = { id: "cus_1", email: "buyer@example.com" }

describe("decideCustomerAttach — a customer lives in TWO places", () => {
  /**
   * 🔴 The whole point of the pair. The detail route reads the link FIRST and
   * the cart second, so writing one without the other leaves a design order
   * that looks owned on screen and checks out anonymous, or vice versa (#1946).
   */
  it("writes the cart AND the link on a fresh attach", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: openCart,
      linkedCustomerIds: [],
      customer: buyer,
    })

    expect(d.ok).toBe(true)
    if (!d.ok) return
    expect(d.cart).toEqual({ customer_id: "cus_1", email: "buyer@example.com" })
    expect(d.link).toEqual({ design_id: "des_1", customer_id: "cus_1" })
    expect(d.noop).toBe(false)
  })

  /**
   * 🔴 `design-customer-link` is `isList: true` on BOTH sides, so attaching
   * without dismissing accumulates buyers — and the detail route then reads
   * `[0]`, whichever the database returns first. A design order has one buyer.
   */
  it("dismisses the previous customer instead of accumulating one", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: { ...openCart, customer_id: "cus_old", email: "old@example.com" },
      linkedCustomerIds: ["cus_old"],
      customer: buyer,
    })

    if (!d.ok) throw new Error("expected ok")
    expect(d.dismiss).toEqual([{ design_id: "des_1", customer_id: "cus_old" }])
    expect(d.link).toEqual({ design_id: "des_1", customer_id: "cus_1" })
  })

  it("dismisses every stale link, not just one", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: openCart,
      linkedCustomerIds: ["cus_a", "cus_b", "cus_a"],
      customer: buyer,
    })

    if (!d.ok) throw new Error("expected ok")
    expect(d.dismiss.map((x) => x.customer_id).sort()).toEqual(["cus_a", "cus_b"])
  })

  it("does not dismiss the customer it is attaching", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: { ...openCart, customer_id: "cus_1", email: "buyer@example.com" },
      linkedCustomerIds: ["cus_1"],
      customer: buyer,
    })

    if (!d.ok) throw new Error("expected ok")
    expect(d.dismiss).toEqual([])
    expect(d.link).toBeNull() // already linked — nothing to create
    expect(d.noop).toBe(true)
  })

  /** Re-running the same attach must not churn the cart or the links. */
  it("is idempotent", () => {
    const settled = {
      designId: "des_1",
      cart: { ...openCart, customer_id: "cus_1", email: "buyer@example.com" },
      linkedCustomerIds: ["cus_1"],
      customer: buyer,
    }
    expect(decideCustomerAttach(settled)).toEqual(decideCustomerAttach(settled))
  })

  it("detaches: clears the cart and dismisses every link", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: { ...openCart, customer_id: "cus_1", email: "buyer@example.com" },
      linkedCustomerIds: ["cus_1"],
      customer: null,
    })

    if (!d.ok) throw new Error("expected ok")
    expect(d.cart).toEqual({ customer_id: null, email: null })
    expect(d.link).toBeNull()
    expect(d.dismiss).toEqual([{ design_id: "des_1", customer_id: "cus_1" }])
  })

  /**
   * An invented address is an unreachable buyer on a real order — the same
   * rule the cart creation step states. Blank is not an email.
   */
  it("normalises a blank email to null rather than writing one", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: openCart,
      linkedCustomerIds: [],
      customer: { id: "cus_1", email: "   " },
    })

    if (!d.ok) throw new Error("expected ok")
    expect(d.cart.email).toBeNull()
    expect(d.cart.customer_id).toBe("cus_1")
  })

  /** 🔴 A completed cart is history — the ORDER is the record after that. */
  it("REFUSES a cart that has already been converted", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: { ...openCart, completed_at: "2026-09-01T00:00:00Z" },
      linkedCustomerIds: [],
      customer: buyer,
    })

    expect(d.ok).toBe(false)
    if (d.ok) return
    expect(d.reason).toBe("cart_completed")
    expect(d.message).toContain("order")
  })

  it("refuses when there is no cart at all", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: null,
      linkedCustomerIds: [],
      customer: buyer,
    })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe("no_cart")
  })
})

describe("decideReprice", () => {
  it("accepts a new positive price and reports the previous one", () => {
    const d = decideReprice({ cart: openCart, currentUnitPrice: 800, unitPrice: 950 })
    expect(d).toEqual({ ok: true, unit_price: 950, previous: 800 })
  })

  it("accepts a numeric string, because a JSON body may carry one", () => {
    const d = decideReprice({ cart: openCart, currentUnitPrice: 800, unitPrice: "950" })
    expect(d.ok).toBe(true)
    if (d.ok) expect(d.unit_price).toBe(950)
  })

  /**
   * 🔴 `Number(null)` is 0 and `Number("")` is 0 — a missing field arrives
   * looking like a deliberate zero, and a price of 0 is a claim (#1900).
   */
  it("REFUSES 0, null, '' and undefined alike", () => {
    for (const bad of [0, null, "", undefined, -5, NaN, "abc"]) {
      const d = decideReprice({ cart: openCart, currentUnitPrice: 800, unitPrice: bad })
      expect(d.ok).toBe(false)
      if (!d.ok) expect(d.reason).toBe("not_a_price")
    }
  })

  it("refuses a price identical to the current one", () => {
    const d = decideReprice({ cart: openCart, currentUnitPrice: 950, unitPrice: 950 })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe("unchanged")
  })

  it("allows any positive price when the line has none recorded", () => {
    const d = decideReprice({ cart: openCart, currentUnitPrice: null, unitPrice: 10 })
    expect(d).toEqual({ ok: true, unit_price: 10, previous: null })
  })

  it("REFUSES a converted cart — reprice the order, not the cart", () => {
    const d = decideReprice({
      cart: { ...openCart, completed_at: new Date() },
      currentUnitPrice: 800,
      unitPrice: 950,
    })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe("cart_completed")
  })
})

/**
 * 🔴 The guard that did not guard.
 *
 * The first cut refused only on `cart.completed_at`. Measured on a real local
 * database: **2 of 48 carts** carry it, and `order_cart` holds **1 row for 290
 * orders**. So a converted design order sailed through — observed live: the
 * drawer reported "Repriced 1200 → 1234.5 EUR" on an order that had already
 * been placed, and the buyer's ORDER was untouched. A silent no-op reported as
 * success.
 */
describe("isConverted — completed_at alone is not the answer", () => {
  it("says converted when the cart says so", () => {
    expect(isConverted({ cart: { completed_at: "2026-09-01T00:00:00Z" } })).toBe(true)
  })

  it("says converted on a linked order even when completed_at is NULL", () => {
    expect(isConverted({ cart: { completed_at: null }, hasLinkedOrder: true })).toBe(true)
  })

  it("says NOT converted only when neither signal fires", () => {
    expect(isConverted({ cart: { completed_at: null }, hasLinkedOrder: false })).toBe(false)
    expect(isConverted({ cart: null })).toBe(false)
  })
})

describe("the linked order refuses both mutations", () => {
  it("refuses a reprice on a cart with completed_at NULL but an order linked", () => {
    const d = decideReprice({
      cart: { id: "cart_1", completed_at: null },
      currentUnitPrice: 1200,
      unitPrice: 1234.5,
      hasLinkedOrder: true,
    })
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.reason).toBe("cart_completed")
      expect(d.message).toContain("order edit")
    }
  })

  it("refuses an attach on the same shape", () => {
    const d = decideCustomerAttach({
      designId: "des_1",
      cart: { id: "cart_1", customer_id: null, email: null, completed_at: null },
      linkedCustomerIds: [],
      customer: { id: "cus_1", email: "a@b.c" },
      hasLinkedOrder: true,
    })
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe("cart_completed")
  })

  it("still allows both when no order is linked", () => {
    expect(
      decideReprice({
        cart: { id: "cart_1", completed_at: null },
        currentUnitPrice: 1200,
        unitPrice: 1300,
        hasLinkedOrder: false,
      }).ok
    ).toBe(true)
  })
})

/**
 * #2176 item 6 — a design order created wrong could only be ABANDONED.
 *
 * `/admin/designs/orders/:lineItemId` was GET only: no cancel, no delete. A
 * wrong-currency order sat in the list forever, indistinguishable from one a
 * customer simply had not paid yet. The live case: an INR design order for a
 * buyer in the EU, which the India region can only offer PayU for.
 */
describe("decideCancel", () => {
  const cart = (over: Record<string, any> = {}) => ({
    id: "cart_1",
    completed_at: null,
    metadata: {},
    ...over,
  })
  const NOW = new Date("2026-09-19T13:00:00.000Z")

  it("cancels an open design order and stamps the time", () => {
    const d = decideCancel({ cart: cart(), reason: "Wrong currency for an EU buyer", now: NOW })
    expect(d).toEqual({
      ok: true,
      cancelled_at: "2026-09-19T13:00:00.000Z",
      cancelled_reason: "Wrong currency for an EU buyer",
    })
  })

  /**
   * 🔴 Required, not politeness. A cancelled design order and a stale one look
   * identical a month later; the reason is the whole difference.
   */
  it("refuses without a reason — including whitespace and non-strings", () => {
    for (const reason of [undefined, null, "", "   ", 42, {}]) {
      const d = decideCancel({ cart: cart(), reason })
      expect(d.ok).toBe(false)
      expect((d as any).reason).toBe("no_reason")
    }
  })

  it("trims the reason rather than storing the operator's spacing", () => {
    const d = decideCancel({ cart: cart(), reason: "  duplicate order  ", now: NOW })
    expect((d as any).cancelled_reason).toBe("duplicate order")
  })

  /**
   * A converted design order has a live ORDER. Stamping its cart would leave
   * the admin screen saying "cancelled" over an order still being fulfilled.
   */
  it("refuses a converted design order — cancel the order instead", () => {
    const viaLink = decideCancel({ cart: cart(), reason: "x", hasLinkedOrder: true })
    expect((viaLink as any).reason).toBe("cart_completed")

    const viaCompletedAt = decideCancel({
      cart: cart({ completed_at: "2026-09-01T00:00:00.000Z" }),
      reason: "x",
    })
    expect((viaCompletedAt as any).reason).toBe("cart_completed")
  })

  /**
   * 🔴 Idempotent, and says so. Re-cancelling would overwrite the ORIGINAL
   * reason and date with today's, losing the only record of why.
   */
  it("refuses a second cancel rather than overwriting the first reason", () => {
    const d = decideCancel({
      cart: cart({ metadata: { cancelled_at: "2026-09-18T10:00:00.000Z" } }),
      reason: "changed my mind again",
    })
    expect(d.ok).toBe(false)
    expect((d as any).reason).toBe("already_cancelled")
    expect((d as any).message).toContain("2026-09-18T10:00:00.000Z")
  })

  it("an empty cancelled_at stamp does not count as cancelled", () => {
    const d = decideCancel({
      cart: cart({ metadata: { cancelled_at: "   " } }),
      reason: "real reason",
      now: NOW,
    })
    expect(d.ok).toBe(true)
  })

  it("refuses when there is no cart at all", () => {
    expect((decideCancel({ cart: null, reason: "x" }) as any).reason).toBe("no_cart")
  })
})

describe("isCancelled", () => {
  it("reads the stamp, and only a real one", () => {
    expect(isCancelled({ metadata: { cancelled_at: "2026-09-19T13:00:00.000Z" } })).toBe(true)
    expect(isCancelled({ metadata: { cancelled_at: "" } })).toBe(false)
    expect(isCancelled({ metadata: { cancelled_at: "  " } })).toBe(false)
    expect(isCancelled({ metadata: {} })).toBe(false)
    expect(isCancelled({ metadata: null })).toBe(false)
    expect(isCancelled(null)).toBe(false)
    expect(isCancelled(undefined)).toBe(false)
  })

  it("a non-string stamp is not a cancellation", () => {
    expect(isCancelled({ metadata: { cancelled_at: true as any } })).toBe(false)
    expect(isCancelled({ metadata: { cancelled_at: 1 as any } })).toBe(false)
  })
})
