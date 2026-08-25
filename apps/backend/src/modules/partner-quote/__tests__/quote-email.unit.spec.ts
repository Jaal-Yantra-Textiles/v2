import {
  buildQuoteEmailData,
  totalQuotedQuantity,
  formatQuoteDestination,
  formatQuoteExpiry,
  formatQuoteMoney,
} from "../lib/quote-email"

/**
 * The quote email's payload (#1420).
 *
 * Every wrong answer here renders beautifully. A landed total of "₹0.00" on an
 * unpriced quote, a greeting to nobody, an expiry this email invented — all of
 * them produce a well-formed email that a buyer acts on. So the assertions are
 * about the fallbacks, not the happy path.
 */

const QUOTE = {
  recipient_name: "Anja Weber",
  recipient_company: "Weber Textil GmbH",
  quoted_landed_total: 4210.5,
  currency_code: "eur",
  destination_city: "Berlin",
  destination_country_code: "DE",
  expires_at: "2026-09-15T00:00:00.000Z",
}

const NOW = new Date("2026-08-23T10:00:00.000Z")

describe("formatQuoteMoney", () => {
  it("formats an amount in the quote's currency", () => {
    expect(formatQuoteMoney(4210.5, "eur")).toBe("€4,210.50")
  })

  it("returns null for a missing amount — NOT zero", () => {
    // 🔴 The control. `Number(null)` is 0 and 0 is finite, so the obvious
    // implementation turns "we could not price this" into a confident €0.00.
    // That exact shape has already shipped bulk orders free once (#1430).
    expect(formatQuoteMoney(null, "eur")).toBeNull()
    expect(formatQuoteMoney(undefined, "eur")).toBeNull()
  })

  it("formats a real zero, which is a different fact from a missing one", () => {
    expect(formatQuoteMoney(0, "eur")).toBe("€0.00")
  })

  it("returns null with no currency, and degrades rather than throws on a bad one", () => {
    expect(formatQuoteMoney(10, null)).toBeNull()
    expect(formatQuoteMoney(10, "NOTACURRENCY")).toBe("10 NOTACURRENCY")
  })
})

describe("formatQuoteDestination", () => {
  it("names the city and the country", () => {
    expect(formatQuoteDestination({ city: "Berlin", countryCode: "DE" })).toBe(
      "Berlin, Germany"
    )
  })

  it("falls back to the country alone, then to a phrase", () => {
    expect(formatQuoteDestination({ city: null, countryCode: "IN" })).toBe("India")
    expect(formatQuoteDestination({ city: null, countryCode: null })).toBe(
      "your destination"
    )
  })
})

describe("formatQuoteExpiry", () => {
  it("renders the date it was given", () => {
    expect(formatQuoteExpiry("2026-09-15T00:00:00.000Z")).toBe("September 15, 2026")
  })

  it("returns null for a missing or unparseable date rather than inventing one", () => {
    // Expiry is enforced by the price list's own `ends_at`. An email that
    // computes its own date is free to disagree with the thing that actually
    // stops the prices working.
    expect(formatQuoteExpiry(null)).toBeNull()
    expect(formatQuoteExpiry("not a date")).toBeNull()
  })
})

describe("totalQuotedQuantity", () => {
  it("counts PIECES, not lines — the whole point", () => {
    // The defect this replaces: one line of 29 scarves announced itself to the
    // buyer as "1 item(s)", because `line_count` was rendered as a quantity.
    expect(totalQuotedQuantity([{ quantity: 29 }])).toBe(29)
    expect(
      totalQuotedQuantity([{ quantity: 2 }, { quantity: 2 }, { quantity: 6 }])
    ).toBe(10)
  })

  it("skips a line it cannot read rather than poisoning the whole count", () => {
    // `Number(undefined)` is NaN, and one bad line would otherwise put
    // "NaN piece(s)" in a buyer's inbox.
    expect(totalQuotedQuantity([{ quantity: 5 }, {}, { quantity: "x" }])).toBe(5)
    expect(totalQuotedQuantity([{ quantity: 5 }, { quantity: -3 }])).toBe(5)
  })

  it("answers 0 for nothing at all, without throwing", () => {
    expect(totalQuotedQuantity([])).toBe(0)
    expect(totalQuotedQuantity(null)).toBe(0)
    expect(totalQuotedQuantity(undefined)).toBe(0)
  })
})

describe("buildQuoteEmailData", () => {
  const build = (quote: any) =>
    buildQuoteEmailData({
      quote,
      partnerName: "Unique Pashmina",
      quoteUrl: "https://shop.example.com/de/quotes/tok_abc",
      lineCount: 2,
      totalQuantity: 40,
      now: NOW,
    })

  it("carries exactly what the template declares", () => {
    expect(build(QUOTE)).toEqual({
      recipient_name: "Anja Weber",
      partner_name: "Unique Pashmina",
      quote_url: "https://shop.example.com/de/quotes/tok_abc",
      landed_total: "€4,210.50",
      destination: "Berlin, Germany",
      line_count: 2,
      total_quantity: 40,
      expires_on: "September 15, 2026",
      current_year: 2026,
    })
  })

  it("says the total is on the quote rather than printing a fabricated zero", () => {
    expect(build({ ...QUOTE, quoted_landed_total: null }).landed_total).toBe(
      "Shown on your quote"
    )
  })

  it("greets the company when there is no contact name, and never nobody", () => {
    expect(build({ ...QUOTE, recipient_name: null }).recipient_name).toBe(
      "Weber Textil GmbH"
    )
    expect(
      build({ ...QUOTE, recipient_name: "  ", recipient_company: null }).recipient_name
    ).toBe("there")
  })

  it("falls back to the platform when no partner name was passed", () => {
    expect(
      buildQuoteEmailData({
        quote: QUOTE,
        partnerName: null,
        quoteUrl: "u",
        lineCount: 1,
        totalQuantity: 1,
        now: NOW,
      }).partner_name
    ).toBe("Jaal Yantra Textiles")
  })
})
