import { FAIRE_SUPPORTED_CURRENCIES, geoForCurrency } from "../lib/faire-geo"

describe("geoForCurrency", () => {
  it("scopes country prices with ISO-3166 alpha-3 codes Faire accepts", () => {
    expect(geoForCurrency("USD")).toEqual({ country: "USA" })
    expect(geoForCurrency("GBP")).toEqual({ country: "GBR" })
    expect(geoForCurrency("CAD")).toEqual({ country: "CAN" })
    expect(geoForCurrency("AUD")).toEqual({ country: "AUS" })
  })

  it("scopes EUR to the European Union country group", () => {
    expect(geoForCurrency("EUR")).toEqual({ country_group: "EUROPEAN_UNION" })
  })

  it("is case-insensitive (Medusa stores lowercase currency codes)", () => {
    expect(geoForCurrency("usd")).toEqual({ country: "USA" })
  })

  // Faire 400'd the whole product on prod (2026-11): "IN is not a supported
  // ISO-3166 Alpha-3 country code. Valid countries are: USA, CAN, GBR, AUS".
  it("returns null for currencies with no Faire market, so their rows are dropped", () => {
    for (const c of ["INR", "AED", "CHF", "CNY", "IDR", "ILS", ""]) {
      expect(geoForCurrency(c)).toBeNull()
    }
  })

  it("never emits an alpha-2 country", () => {
    for (const c of FAIRE_SUPPORTED_CURRENCIES) {
      const geo = geoForCurrency(c)!
      if (geo.country) expect(geo.country).toMatch(/^[A-Z]{3}$/)
    }
  })
})
