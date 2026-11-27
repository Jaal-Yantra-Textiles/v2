import { parseDelhiveryPinCodes } from "../../../modules/shipping-providers/delhivery/adapter"
import { takeCarrierBudget, weightBucket, resetDeliveryCheckState } from "../index"
import {
  type CarrierAnswer,
  codFromRates,
  etaFromRates,
  mergeDeliveryAnswers,
} from "../merge"
import { normalizePostalCode } from "../validate"

const ok = (
  carrier: string,
  serviceable: boolean,
  cod: boolean | null,
  eta: { min: number; max: number } | null = null
): CarrierAnswer => ({ carrier, status: "ok", serviceable, cod, eta_days: eta })
const err = (carrier: string): CarrierAnswer => ({ carrier, status: "error", reason: "boom" })
const off = (carrier: string): CarrierAnswer => ({ carrier, status: "not_configured" })

const merge = (
  answers: CarrierAnswer[],
  country = "in",
  zone_covers_country: boolean | null = null,
  postal = "110001"
) => mergeDeliveryAnswers({ country_code: country, postal_code: postal, answers, zone_covers_country })

describe("normalizePostalCode", () => {
  it("accepts a 6-digit Indian pin and strips spaces/dashes", () => {
    expect(normalizePostalCode("IN", " 110 001 ")).toEqual({ ok: true, country_code: "in", postal_code: "110001" })
    expect(normalizePostalCode("in", "110-001")).toMatchObject({ ok: true, postal_code: "110001" })
  })

  it.each(["11000", "1100011", "010001", "abcdef", ""])("rejects Indian pin %p", (pin) => {
    expect(normalizePostalCode("in", pin)).toEqual({ ok: false, message: "Enter a 6-digit PIN code." })
  })

  it("checks known foreign formats, loosely", () => {
    expect(normalizePostalCode("us", "10001")).toMatchObject({ ok: true })
    expect(normalizePostalCode("us", "10001-1234")).toMatchObject({ ok: true })
    expect(normalizePostalCode("us", "1000")).toMatchObject({ ok: false })
    expect(normalizePostalCode("gb", "sw1a 1aa")).toMatchObject({ ok: true, postal_code: "SW1A 1AA" })
    expect(normalizePostalCode("nl", "1012 AB")).toMatchObject({ ok: true })
    expect(normalizePostalCode("de", "1011")).toMatchObject({ ok: false })
  })

  it("accepts anything plausible for a country with no pattern", () => {
    expect(normalizePostalCode("br", "01310-100")).toMatchObject({ ok: true })
    expect(normalizePostalCode("br", "x")).toMatchObject({ ok: false })
  })

  it("lets a country with no postal codes leave it empty", () => {
    expect(normalizePostalCode("ae", "")).toEqual({ ok: true, country_code: "ae", postal_code: "" })
    expect(normalizePostalCode("de", "")).toMatchObject({ ok: false })
  })

  it("needs a country", () => {
    expect(normalizePostalCode("", "110001")).toMatchObject({ ok: false })
  })
})

describe("parseDelhiveryPinCodes", () => {
  it("reads serviceable + COD", () => {
    expect(
      parseDelhiveryPinCodes({ delivery_codes: [{ postal_code: { pre_paid: "Y", cod: "Y" } }] })
    ).toEqual({ serviceable: true, cod: true, prepaid: true })
  })
  it("an empty list is 'no', not an error", () => {
    expect(parseDelhiveryPinCodes({ delivery_codes: [] })).toEqual({ serviceable: false, cod: false, prepaid: false })
  })
  it("prepaid-only pin has no COD", () => {
    expect(
      parseDelhiveryPinCodes({ delivery_codes: [{ postal_code: { pre_paid: "Y", cod: "N", cash: "N" } }] })
    ).toEqual({ serviceable: true, cod: false, prepaid: true })
  })
  it("falls back to `cash` when `cod` is absent", () => {
    expect(parseDelhiveryPinCodes({ delivery_codes: [{ postal_code: { pre_paid: "N", cash: "Y" } }] }).cod).toBe(true)
  })
  it("an embargoed pin is not serviceable", () => {
    expect(
      parseDelhiveryPinCodes({ delivery_codes: [{ postal_code: { pre_paid: "Y", cod: "Y", remarks: "Embargo" } }] })
    ).toEqual({ serviceable: false, cod: false, prepaid: false })
  })
})

describe("etaFromRates / codFromRates", () => {
  it("fastest courier to the recommended courier", () => {
    expect(
      etaFromRates([
        { amount: 1, currency_code: "inr", estimated_days: 2 },
        { amount: 1, currency_code: "inr", estimated_days: 4, is_recommended: true },
        { amount: 1, currency_code: "inr", estimated_days: 12 },
      ])
    ).toEqual({ min: 2, max: 4 })
  })
  it("falls back to the slowest when none is recommended; null when no days", () => {
    expect(
      etaFromRates([
        { amount: 1, currency_code: "inr", estimated_days: 3 },
        { amount: 1, currency_code: "inr", estimated_days: 6 },
      ])
    ).toEqual({ min: 3, max: 6 })
    expect(etaFromRates([{ amount: 1, currency_code: "inr" }])).toBeNull()
  })
  it("COD if any courier takes cash; null when nobody says", () => {
    expect(codFromRates([{ amount: 1, currency_code: "inr", cod_available: false }, { amount: 1, currency_code: "inr", cod_available: true }])).toBe(true)
    expect(codFromRates([{ amount: 1, currency_code: "inr", cod_available: false }])).toBe(false)
    expect(codFromRates([{ amount: 1, currency_code: "inr" }])).toBeNull()
  })
})

describe("mergeDeliveryAnswers", () => {
  it("both carriers say yes: Delhivery decides COD, Shiprocket gives the ETA", () => {
    const r = merge([ok("delhivery", true, false), ok("shiprocket", true, true, { min: 2, max: 4 })])
    expect(r).toMatchObject({
      serviceable: true,
      cod_available: false,
      eta_days: { min: 2, max: 4 },
      source: ["delhivery", "shiprocket"],
    })
    expect(r.message).toBe("Delivers to PIN 110001 in 2–4 days.")
  })

  it("Delhivery says no but a Shiprocket courier goes there: serviceable, COD from Shiprocket", () => {
    const r = merge([ok("delhivery", false, false), ok("shiprocket", true, true, { min: 5, max: 5 })])
    expect(r).toMatchObject({ serviceable: true, cod_available: true, eta_days: { min: 5, max: 5 } })
    expect(r.message).toBe("Delivers to PIN 110001 in about 5 days.")
  })

  it("everyone who answered says no", () => {
    const r = merge([ok("delhivery", false, false), ok("shiprocket", false, null)])
    expect(r).toMatchObject({ serviceable: false, cod_available: false, eta_days: null })
    expect(r.message).toBe("Sorry, we don't deliver to PIN 110001 yet.")
  })

  it("a 'no' next to a failed carrier is unknown, not no", () => {
    expect(merge([ok("delhivery", false, false), err("shiprocket")]).serviceable).toBeNull()
  })

  it("a 'yes' next to a failed carrier is still yes", () => {
    expect(merge([ok("delhivery", true, true), err("shiprocket")])).toMatchObject({
      serviceable: true,
      cod_available: true,
      eta_days: null,
      source: ["delhivery"],
    })
  })

  it("every configured carrier failed: unknown + soft message", () => {
    const r = merge([err("delhivery"), off("shiprocket")])
    expect(r).toMatchObject({ serviceable: null, cod_available: null, eta_days: null, source: [] })
    expect(r.message).toMatch(/couldn't check/)
  })

  it("only Shiprocket configured: its courier COD flags answer COD", () => {
    expect(merge([off("delhivery"), ok("shiprocket", true, false, { min: 3, max: 4 })]).cod_available).toBe(false)
    expect(merge([off("delhivery"), ok("shiprocket", true, null)]).cod_available).toBeNull()
  })

  it("international is never COD", () => {
    const r = merge([ok("shiprocket", true, null, { min: 6, max: 10 }), off("shipglobal")], "de", null, "10115")
    expect(r).toMatchObject({ serviceable: true, cod_available: false, eta_days: { min: 6, max: 10 } })
    expect(r.message).toBe("Delivers to 10115, Germany in 6–10 days.")
  })

  it("international ETA spans both carriers", () => {
    const r = merge(
      [ok("shiprocket", true, false, { min: 4, max: 6 }), ok("shipglobal", true, false, { min: 7, max: 9 })],
      "us",
      null,
      "10001"
    )
    expect(r.eta_days).toEqual({ min: 4, max: 9 })
  })

  describe("no carrier configured", () => {
    it("falls back to the store's shipping zones, with no ETA", () => {
      const r = merge([off("shiprocket"), off("shipglobal")], "de", true, "10115")
      expect(r).toMatchObject({
        serviceable: true,
        cod_available: false,
        eta_days: null,
        source: ["store_shipping_zones"],
        message: "We ship to Germany.",
      })
    })
    it("India via zones: COD unknown", () => {
      expect(merge([off("delhivery"), off("shiprocket")], "in", true).cod_available).toBeNull()
    })
    it("no zone for the country", () => {
      const r = merge([off("shiprocket"), off("shipglobal")], "jp", false, "100-0001")
      expect(r.serviceable).toBe(false)
      expect(r.message).toBe("Sorry, we don't deliver to 100-0001, Japan yet.")
    })
    it("no store location at all: unknown", () => {
      expect(merge([off("delhivery"), off("shiprocket")], "in", null).serviceable).toBeNull()
    })
  })
})

describe("bounding", () => {
  beforeEach(() => resetDeliveryCheckState())

  it("a carrier gets a fixed number of calls per minute", () => {
    const t = 1_000_000
    for (let i = 0; i < 3; i++) expect(takeCarrierBudget("x", t + i, 3)).toBe(true)
    expect(takeCarrierBudget("x", t + 10, 3)).toBe(false)
    expect(takeCarrierBudget("y", t + 10, 3)).toBe(true)
    expect(takeCarrierBudget("x", t + 60_001, 3)).toBe(true)
  })

  it("weight buckets", () => {
    expect(weightBucket(300)).toBe(500)
    expect(weightBucket(501)).toBe(1000)
    expect(weightBucket(4200)).toBe(5000)
    expect(weightBucket(12000)).toBe(15000)
  })
})
