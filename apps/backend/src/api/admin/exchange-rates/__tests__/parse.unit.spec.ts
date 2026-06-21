import { parseTargetCurrencies, buildRatesResponse } from "../parse"

describe("exchange-rates parse helpers", () => {
  describe("parseTargetCurrencies", () => {
    it("splits, trims, upper-cases and de-dupes", () => {
      expect(parseTargetCurrencies("eur, usd ,gbp", "INR")).toEqual([
        "EUR",
        "USD",
        "GBP",
      ])
    })

    it("excludes the base currency (case-insensitive)", () => {
      expect(parseTargetCurrencies("inr,eur", "INR")).toEqual(["EUR"])
      expect(parseTargetCurrencies("Inr,Eur", "inr")).toEqual(["EUR"])
    })

    it("drops duplicates", () => {
      expect(parseTargetCurrencies("eur,EUR,usd,usd", "INR")).toEqual([
        "EUR",
        "USD",
      ])
    })

    it("returns [] for empty/undefined input", () => {
      expect(parseTargetCurrencies(undefined, "INR")).toEqual([])
      expect(parseTargetCurrencies("", "INR")).toEqual([])
      expect(parseTargetCurrencies(" , ,", "INR")).toEqual([])
    })
  })

  describe("buildRatesResponse", () => {
    it("upper-cases base and keeps finite numeric rates", () => {
      expect(
        buildRatesResponse("inr", [
          ["eur", 0.011],
          ["usd", 0.012],
        ])
      ).toEqual({ base: "INR", rates: { EUR: 0.011, USD: 0.012 } })
    })

    it("omits null / undefined / non-finite rates", () => {
      expect(
        buildRatesResponse("INR", [
          ["eur", null],
          ["usd", undefined],
          ["gbp", NaN],
          ["aud", 0.018],
        ])
      ).toEqual({ base: "INR", rates: { AUD: 0.018 } })
    })

    it("returns an empty rates map for no pairs", () => {
      expect(buildRatesResponse("INR", [])).toEqual({ base: "INR", rates: {} })
    })
  })
})
