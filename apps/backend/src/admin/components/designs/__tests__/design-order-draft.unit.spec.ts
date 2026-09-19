import {
  resolveDesignOrderTarget,
  designOrderRoutes,
  designOrderCreateBody,
} from "../design-order-draft"

describe("resolveDesignOrderTarget", () => {
  it("treats NO customer as an ordinary order, not a refusal (#1817)", () => {
    // The common case: most designs are made for stock, from a brief, or out
    // of the assistant, and never carry a customer link.
    const r = resolveDesignOrderTarget([{ id: "d1" }, { id: "d2" }])
    expect(r).toEqual({ ok: true, customer_id: null, design_ids: ["d1", "d2"] })
  })

  it("uses the one customer when every design shares it", () => {
    const r = resolveDesignOrderTarget([
      { id: "d1", customer_id: "cus_1" },
      { id: "d2", customer_id: "cus_1" },
    ])
    expect(r).toMatchObject({ ok: true, customer_id: "cus_1" })
  })

  it("uses the customer even when only some designs carry it", () => {
    // One linked design and one unlinked is not ambiguous: there is exactly
    // one buyer named anywhere in the selection.
    const r = resolveDesignOrderTarget([
      { id: "d1", customer_id: "cus_1" },
      { id: "d2", customer_id: null },
    ])
    expect(r).toMatchObject({ ok: true, customer_id: "cus_1" })
  })

  it("REFUSES two customers — a cart on the wrong buyer is worse than one on none", () => {
    const r = resolveDesignOrderTarget([
      { id: "d1", customer_id: "cus_1" },
      { id: "d2", customer_id: "cus_2" },
    ])
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error("expected a refusal")
    expect(r.error.title).toMatch(/multiple customers/i)
  })

  it("does not count an empty-string customer as a second buyer", () => {
    // `""` is falsy but not null — the shape that has defeated guards
    // elsewhere in this codebase. Unfiltered it would make this "2 customers"
    // and refuse a perfectly ordinary selection.
    const r = resolveDesignOrderTarget([
      { id: "d1", customer_id: "cus_1" },
      { id: "d2", customer_id: "" },
      { id: "d3", customer_id: "   " },
    ])
    expect(r).toMatchObject({ ok: true, customer_id: "cus_1" })
  })

  it("refuses an empty selection rather than posting an empty order", () => {
    const r = resolveDesignOrderTarget([])
    expect(r.ok).toBe(false)
  })

  it("keeps the design ids in the order they were selected", () => {
    const r = resolveDesignOrderTarget([{ id: "d3" }, { id: "d1" }, { id: "d2" }])
    expect(r).toMatchObject({ design_ids: ["d3", "d1", "d2"] })
  })
})

describe("designOrderRoutes", () => {
  it("uses the customer-less twin when there is no buyer", () => {
    expect(designOrderRoutes(null)).toEqual({
      preview: "/admin/designs/draft-order/preview",
      create: "/admin/designs/draft-order",
    })
  })

  it("puts the customer in the path when there is one", () => {
    expect(designOrderRoutes("cus_1")).toEqual({
      preview: "/admin/customers/cus_1/design-order/preview",
      create: "/admin/customers/cus_1/design-order",
    })
  })

  it("never emits a path with an empty id segment", () => {
    // `/admin/customers//design-order` would 404 in a way that reads as a
    // missing route rather than a missing customer.
    for (const route of Object.values(designOrderRoutes(null))) {
      expect(route).not.toMatch(/\/\//)
    }
  })
})

describe("designOrderCreateBody", () => {
  it("omits price_overrides entirely when there are none", () => {
    // The route reads PRESENCE, not size: an empty object is a statement that
    // prices were overridden, to nothing.
    const body = designOrderCreateBody({ design_ids: ["d1"] })
    expect(body.price_overrides).toBeUndefined()
  })

  it("omits price_overrides when the map is empty", () => {
    const body = designOrderCreateBody({ design_ids: ["d1"], price_overrides: {} })
    expect(body.price_overrides).toBeUndefined()
  })

  it("passes overrides through when there are some", () => {
    const body = designOrderCreateBody({
      design_ids: ["d1"],
      price_overrides: { d1: 1200 },
      override_currency: "inr",
    })
    expect(body).toMatchObject({
      design_ids: ["d1"],
      price_overrides: { d1: 1200 },
      override_currency: "inr",
    })
  })

  it("keeps a zero override — 0 is a price, not an absence", () => {
    const body = designOrderCreateBody({
      design_ids: ["d1"],
      price_overrides: { d1: 0 },
    })
    expect(body.price_overrides).toEqual({ d1: 0 })
  })
})

/**
 * #2176 item 5 — every design order was INR because nothing ever sent a
 * currency. `create-draft-order-from-designs` falls through to
 * `input.currency_code || "inr"`, so a European buyer was quoted in rupees and
 * routed to PayU, the India region's only payment provider.
 */
describe("designOrderCreateBody — the cart's currency", () => {
  it("carries currency_code so the cart is not silently INR", () => {
    const body = designOrderCreateBody({
      design_ids: ["d1"],
      currency_code: "eur",
    })
    expect(body.currency_code).toBe("eur")
  })

  /**
   * 🔴 Two different facts. `currency_code` is what the CART is created in;
   * `override_currency` only says what any manual prices are denominated in.
   * Collapsing them would price a cart in one currency and label the overrides
   * with another.
   */
  it("keeps currency_code and override_currency as separate fields", () => {
    const body = designOrderCreateBody({
      design_ids: ["d1"],
      price_overrides: { d1: 90 },
      currency_code: "eur",
      override_currency: "eur",
    })
    expect(body.currency_code).toBe("eur")
    expect(body.override_currency).toBe("eur")
    expect(body.price_overrides).toEqual({ d1: 90 })
  })

  it("omitting it leaves the field undefined rather than inventing a default", () => {
    // The route's own fallback is the one place "inr" should be decided.
    const body = designOrderCreateBody({ design_ids: ["d1"] })
    expect(body.currency_code).toBeUndefined()
  })
})
