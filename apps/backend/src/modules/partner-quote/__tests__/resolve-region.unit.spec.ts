import { pickQuoteRegion } from "../lib/resolve-region"

// The prod shape that produced #1787: one AUD region covering au, one INR
// region covering in, and two EUR regions so ambiguity is representable.
const REGIONS = [
  { id: "reg_in", currency_code: "inr", countries: [{ iso_2: "in" }] },
  { id: "reg_au", currency_code: "aud", countries: [{ iso_2: "au" }] },
  { id: "reg_eu", currency_code: "eur", countries: [{ iso_2: "de" }, { iso_2: "nl" }] },
  { id: "reg_us", currency_code: "usd", countries: [{ iso_2: "us" }] },
]

describe("pickQuoteRegion", () => {
  it("derives the AU region from aud + au — the case that broke", () => {
    // The quote carried destination AU and currency AUD and stored no region,
    // so accept fell back to the INR store default and offered PayU only.
    expect(
      pickQuoteRegion(REGIONS, {
        region_id: null,
        currency_code: "AUD",
        destination_country_code: "AU",
      })
    ).toEqual({ region_id: "reg_au", source: "derived" })
  })

  it("keeps an explicit region_id", () => {
    expect(
      pickQuoteRegion(REGIONS, {
        region_id: "reg_eu",
        currency_code: "eur",
        destination_country_code: "de",
      })
    ).toEqual({ region_id: "reg_eu", source: "explicit" })
  })

  it("refuses an explicit region whose currency contradicts the quote", () => {
    // The rule `currency_code` already advertises — "must match the region's
    // currency" — stated to callers and, until now, enforced against nobody.
    const out = pickQuoteRegion(REGIONS, {
      region_id: "reg_in",
      currency_code: "aud",
      destination_country_code: "au",
    })
    expect(out.region_id).toBeNull()
    expect(out).toMatchObject({ source: "none" })
    expect((out as any).reason).toMatch(/denominated in inr/)
  })

  it("refuses a region_id that does not exist", () => {
    const out = pickQuoteRegion(REGIONS, {
      region_id: "reg_nope",
      currency_code: "aud",
      destination_country_code: "au",
    })
    expect(out.region_id).toBeNull()
    expect((out as any).reason).toMatch(/does not exist/)
  })

  it("requires BOTH currency and country to match, never either alone", () => {
    // aud exists, but not for a German destination — matching on currency alone
    // would have picked reg_au and quoted an Australian sale into Germany.
    expect(
      pickQuoteRegion(REGIONS, {
        region_id: null,
        currency_code: "aud",
        destination_country_code: "de",
      }).region_id
    ).toBeNull()

    // de exists, but the quote is priced in usd — matching on country alone
    // would have put a USD quote in a EUR region.
    expect(
      pickQuoteRegion(REGIONS, {
        region_id: null,
        currency_code: "usd",
        destination_country_code: "de",
      }).region_id
    ).toBeNull()
  })

  it("refuses rather than guessing when two regions claim the sale", () => {
    const ambiguous = [
      ...REGIONS,
      { id: "reg_eu2", currency_code: "eur", countries: [{ iso_2: "de" }] },
    ]
    const out = pickQuoteRegion(ambiguous, {
      region_id: null,
      currency_code: "eur",
      destination_country_code: "de",
    })
    expect(out.region_id).toBeNull()
    expect((out as any).reason).toMatch(/2 regions claim EUR \+ DE/)
    expect((out as any).reason).toMatch(/reg_eu, reg_eu2/)
  })

  it("says what is missing when there is nothing to derive from", () => {
    const out = pickQuoteRegion(REGIONS, {
      region_id: null,
      currency_code: null,
      destination_country_code: "au",
    })
    expect(out.region_id).toBeNull()
    expect((out as any).reason).toMatch(/no currency \+ destination/)
  })

  it("is case- and whitespace-insensitive on both keys", () => {
    expect(
      pickQuoteRegion(REGIONS, {
        region_id: null,
        currency_code: " Aud ",
        destination_country_code: " Au ",
      })
    ).toEqual({ region_id: "reg_au", source: "derived" })
  })

  it("reports no match instead of throwing when no region covers the pair", () => {
    const out = pickQuoteRegion(REGIONS, {
      region_id: null,
      currency_code: "jpy",
      destination_country_code: "jp",
    })
    expect(out.region_id).toBeNull()
    expect((out as any).reason).toMatch(/no region covers JPY \+ JP/)
  })
})
