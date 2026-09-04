import { deriveQuoteCartTerms } from "../[id]/quote-terms/lib"

/**
 * #1787 — what a buyer is TOLD about a quote cart must be what she is CHARGED.
 *
 * The figures below are the live AUD quote that could not be paid:
 * total A$314.77, deposit A$94.43 (30%), balance A$220.34.
 */
const AU_CART = {
  id: "cart_au",
  currency_code: "aud",
  total: 314.77,
  metadata: { quote_id: "01M1BPV6TMK0SVH32HX6SMQ25Z", partner_id: "p_1" },
}

const AU_SCHEDULE = {
  id: "sched_au",
  currency_code: "aud",
  total_due: "314.77",
  deposit_pct: 30,
  deposit_amount: "94.43",
  deposit_status: "pending",
  balance_status: "not_due",
  rail: "stripe",
}

describe("deriveQuoteCartTerms", () => {
  it("splits the cart into what is due now and what is due later", () => {
    const terms = deriveQuoteCartTerms(AU_CART, AU_SCHEDULE)

    expect(terms.is_quote_cart).toBe(true)
    expect(terms.quote_id).toBe("01M1BPV6TMK0SVH32HX6SMQ25Z")
    expect(terms.deposit_due_now).toBe(94.43)
    expect(terms.balance_due_later).toBe(220.34)
    expect(terms.deposit_pct).toBe(30)
    expect(terms.rail).toBe("stripe")
    expect(terms.unavailable_reason).toBeNull()
  })

  it("the two halves add back up to the cart total", () => {
    const terms = deriveQuoteCartTerms(AU_CART, AU_SCHEDULE)

    // 🔴 The assertion that catches a rounding split which quietly loses or
    // invents a cent — the buyer would be shown a balance that never squares.
    expect(
      Math.round(
        ((terms.deposit_due_now as number) +
          (terms.balance_due_later as number)) *
          100
      )
    ).toBe(Math.round((terms.total as number) * 100))
  })

  it("says nothing about a cart that did not come from a quote", () => {
    const terms = deriveQuoteCartTerms(
      { ...AU_CART, metadata: null },
      AU_SCHEDULE
    )

    // An ordinary cart must look exactly as it did before, even if some
    // schedule row happens to exist for it.
    expect(terms.is_quote_cart).toBe(false)
    expect(terms.deposit_due_now).toBeNull()
    expect(terms.quote_id).toBeNull()
  })

  it("reports a quote cart with no schedule rather than inventing a split", () => {
    const terms = deriveQuoteCartTerms(AU_CART, null)

    expect(terms.is_quote_cart).toBe(true)
    expect(terms.deposit_due_now).toBeNull()
    expect(terms.unavailable_reason).toMatch(/no payment schedule/i)
  })

  it("advertises no split for a pay-in-full quote", () => {
    const terms = deriveQuoteCartTerms(AU_CART, {
      ...AU_SCHEDULE,
      deposit_pct: 100,
      deposit_amount: "314.77",
    })

    // `deposit_pct: 100` is legitimate — it is "pay in full", not a defect, so
    // there is nothing to advertise and nothing to apologise for.
    expect(terms.is_quote_cart).toBe(true)
    expect(terms.deposit_due_now).toBeNull()
    expect(terms.unavailable_reason).toBeNull()
  })

  it("refuses to advertise a deposit larger than the cart", () => {
    const terms = deriveQuoteCartTerms(AU_CART, {
      ...AU_SCHEDULE,
      deposit_amount: "9999.00",
    })

    expect(terms.deposit_due_now).toBeNull()
    expect(terms.unavailable_reason).toBeTruthy()
  })

  it("treats a stored zero deposit as no deposit, not a free one", () => {
    // 🔑 `> 0`, not `!= null` — `Number(null)` is 0 and a stored 0 would
    // otherwise advertise "pay nothing today".
    const terms = deriveQuoteCartTerms(AU_CART, {
      ...AU_SCHEDULE,
      deposit_amount: "0",
    })

    expect(terms.deposit_due_now).toBeNull()
    expect(terms.unavailable_reason).toBeTruthy()
  })

  it("carries the deposit status through, so a PAID deposit is not re-advertised", () => {
    const terms = deriveQuoteCartTerms(AU_CART, {
      ...AU_SCHEDULE,
      deposit_status: "paid",
    })

    expect(terms.deposit_status).toBe("paid")
    // The plan refuses a second collection on a paid deposit; the page must
    // therefore not show "pay 94.43 now" again.
    expect(terms.deposit_due_now).toBeNull()
    expect(terms.unavailable_reason).toMatch(/paid/i)
  })
})
