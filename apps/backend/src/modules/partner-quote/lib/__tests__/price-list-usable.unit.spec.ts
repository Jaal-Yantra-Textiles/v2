import {
  priceListUnusableReason,
  quoteExpiryFrom,
  quoteUnusableReason,
} from "../token"

/**
 * #1857 — the half of "can this quote still price?" that lives on the price
 * list.
 *
 * The audit flagged `partner_quote.price_list_id` as 10 of 12 dangling in prod.
 * It is not debris: `revokeQuote` DELETES the price list, so a revoked quote
 * pointing at a deleted list is the designed terminal state. What the audit
 * could not see is that `accept-quote` guarded on the COLUMN BEING SET, never
 * on the list still being able to price — and the gap between those two is a
 * cart silently built at base prices, not an error.
 */

const NOW = new Date("2026-09-07T12:00:00.000Z")
const past = new Date(NOW.getTime() - 1000).toISOString()
const future = new Date(NOW.getTime() + 1000).toISOString()

describe("priceListUnusableReason", () => {
  it("passes a live, active, in-window list", () => {
    expect(
      priceListUnusableReason(
        { id: "pl_1", status: "active", starts_at: past, ends_at: future },
        NOW
      )
    ).toBeNull()
  })

  it("treats a soft-deleted list exactly like a missing one", () => {
    /*
     * 🔴 The whole point. `query.graph` returns NO ROW for a soft-deleted
     * price list, identically to one that never existed — establishing that
     * the question is VISIBILITY, not existence, is what took the #1857 prod
     * sweep from 27 pairs to 46.
     */
    expect(priceListUnusableReason(undefined, NOW)).toBe("missing")
    expect(priceListUnusableReason(null, NOW)).toBe("missing")
    expect(priceListUnusableReason({ id: "pl_1", deleted_at: past }, NOW)).toBe(
      "missing"
    )
  })

  it("refuses a list that has ENDED — the revoke/supersede shape", () => {
    // Superseding a quote dates the prior list to `now` rather than deleting
    // it, so the row is perfectly visible and completely inert.
    expect(
      priceListUnusableReason(
        { id: "pl_1", status: "active", ends_at: past },
        NOW
      )
    ).toBe("ended")
  })

  it("refuses a draft list", () => {
    expect(
      priceListUnusableReason({ id: "pl_1", status: "draft" }, NOW)
    ).toBe("draft")
  })

  it("refuses a list that has not started", () => {
    expect(
      priceListUnusableReason(
        { id: "pl_1", status: "active", starts_at: future },
        NOW
      )
    ).toBe("not_started")
  })

  it("accepts an ISO STRING clock, because a step boundary serialises Date", () => {
    /*
     * The trap `quoteUnusableReason` already carries a docblock about: a Date
     * handed between workflow steps arrives as a string, and tsc cannot see it
     * because the declared types describe the graph, not the payload.
     */
    expect(
      priceListUnusableReason(
        { id: "pl_1", status: "active", ends_at: past },
        NOW.toISOString() as any
      )
    ).toBe("ended")
  })
})

describe("the invariant this guard turns into an assertion", () => {
  it("is not vacuous: quote and price list lapse together TODAY", () => {
    /*
     * `mint-quote` derives `quote.expires_at` and the list's `ends_at` from one
     * value, so the quote expires at the instant the list goes inert — measured
     * equal to the microsecond on every active quote in the local database.
     * While that holds, the quote guard fires first and this one never does.
     */
    const mintedAt = new Date("2026-09-01T00:00:00.000Z")
    const expiry = quoteExpiryFrom(mintedAt, 14)
    const justAfter = new Date(expiry.getTime() + 1)

    expect(
      quoteUnusableReason({ status: "active", expires_at: expiry }, justAfter)
    ).toBe("expired")
    expect(
      priceListUnusableReason(
        { id: "pl_1", status: "active", ends_at: expiry.toISOString() },
        justAfter
      )
    ).toBe("ended")
  })

  it("catches the drift the quote guard would MISS", () => {
    /*
     * 🔴 The case the guard exists for, and the reason a test that only
     * exercised the aligned pair would be worthless: nothing enforces the two
     * timestamps staying equal. Give the quote a longer life than its list —
     * one changed TTL, one manual edit to a price list — and the quote reads
     * as perfectly acceptable while the cart would price at base.
     */
    const quoteExpiry = new Date("2026-09-20T00:00:00.000Z")
    const listEnded = new Date("2026-09-05T00:00:00.000Z")

    expect(
      quoteUnusableReason({ status: "active", expires_at: quoteExpiry }, NOW)
    ).toBeNull() // the quote says: go ahead

    expect(
      priceListUnusableReason(
        { id: "pl_1", status: "active", ends_at: listEnded.toISOString() },
        NOW
      )
    ).toBe("ended") // the price list says: you would be charging base
  })
})
