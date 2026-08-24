import { composeQuoteAcceptance } from "../lib/quote-acceptance-view"

/**
 * What the buyer is told when they cannot press Accept (#1439 S11, copy #1439 S16).
 *
 * ## The distinction these tests exist to hold
 *
 * The gate is `quoted_shipping_option_id` — whether the destination has a
 * shipping option at all — and NOT whether a person typed the freight.
 *
 * 🔴 The copy used to say the opposite: "Freight on this lane was quoted by
 * hand, so the order cannot be placed online." That blamed the partner's typed
 * rate for a gap in shipping configuration, and a partner who believes it stops
 * typing rates — the exact opposite of what S12 added them for. An override
 * preserves the underlying option, so a typed amount on a rateable lane accepts
 * perfectly well (verified by minting one: ₹777 typed on a Mumbai lane, cart
 * carried it).
 *
 * These assertions pin both halves: the reason must describe the DESTINATION,
 * and must not mention the freight's provenance.
 */
const base = {
  currency_code: "inr",
  deposit_pct: 30,
  quoted_shipping_option_id: "so_1",
  accepted_cart_id: null,
}

describe("composeQuoteAcceptance — the refusal", () => {
  it("accepts when the destination has a shipping option", () => {
    const a = composeQuoteAcceptance({ quote: { ...base }, gross_total: 1000 })
    expect(a.can_accept).toBe(true)
    expect(a.blocked_reason).toBeNull()
  })

  it("🔴 blames the DESTINATION, never the hand-typed rate", () => {
    const a = composeQuoteAcceptance({
      quote: { ...base, quoted_shipping_option_id: null },
      gross_total: 1000,
    })
    expect(a.can_accept).toBe(false)
    expect(a.blocked_reason).toMatch(/destination|route/i)
    // The regression: a partner told their typed rate broke the order stops
    // typing rates, and unrateable lanes become unquotable again.
    expect(a.blocked_reason).not.toMatch(/by hand|hand-typed|quoted by hand/i)
  })

  it("tells the buyer whose move it is", () => {
    // A refusal with no next step reads as a dead end, and the buyer leaves.
    const a = composeQuoteAcceptance({
      quote: { ...base, quoted_shipping_option_id: null },
      gross_total: 1000,
    })
    expect(a.blocked_reason).toMatch(/reply/i)
  })

  it("🔑 a hand-typed amount does NOT block, so long as the lane has an option", () => {
    // The whole point. The override carries `shipping_option_id` through, so
    // provenance is irrelevant to acceptance.
    const a = composeQuoteAcceptance({
      quote: { ...base, quoted_shipping_option_id: "so_1" },
      gross_total: 1000,
    })
    expect(a.can_accept).toBe(true)
  })

  it("prefers the not-open reason over the shipping one", () => {
    // A revoked quote must not be explained as a shipping gap — the buyer
    // would chase a delivery question about a document that no longer stands.
    const a = composeQuoteAcceptance({
      quote: { ...base, quoted_shipping_option_id: null },
      gross_total: 1000,
      unusable_reason: "revoked",
    })
    expect(a.blocked_reason).toMatch(/no longer open/i)
  })

  it("refuses a quote with nothing to charge", () => {
    const a = composeQuoteAcceptance({ quote: { ...base }, gross_total: 0 })
    expect(a.can_accept).toBe(false)
    expect(a.blocked_reason).toMatch(/no total/i)
  })

  it("says nothing is blocked once accepted", () => {
    const a = composeQuoteAcceptance({
      quote: { ...base, accepted_cart_id: "cart_1", quoted_shipping_option_id: null },
      gross_total: 1000,
    })
    expect(a.accepted).toBe(true)
    expect(a.blocked_reason).toBeNull()
  })
})
