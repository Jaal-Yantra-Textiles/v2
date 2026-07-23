import {
  SHIPROCKET_SUPPORTED_CURRENCIES,
  SHIPROCKET_FX_TARGET,
  isShiprocketSupportedCurrency,
  convertShipmentCurrency,
} from "../currency"
import type { CreateShipmentInput } from "../../provider-interface"

/**
 * #1111 S3 — international declared-value currency handling. Shiprocket accepts
 * a fixed currency set; orders priced outside it are converted into USD before
 * the create body is built. Pure — no FX service / DB.
 */

describe("isShiprocketSupportedCurrency", () => {
  it("accepts the documented set (case-insensitive) and rejects the rest", () => {
    for (const c of ["INR", "usd", "GbP", "eur", "AUD", "cad", "SAR", "aed", "SGD"]) {
      expect(isShiprocketSupportedCurrency(c)).toBe(true)
    }
    for (const c of ["THB", "JPY", "ZAR", "MYR", "", null, undefined]) {
      expect(isShiprocketSupportedCurrency(c as any)).toBe(false)
    }
  })

  it("USD is the FX hub target and is itself supported", () => {
    expect(isShiprocketSupportedCurrency(SHIPROCKET_FX_TARGET)).toBe(true)
    expect(SHIPROCKET_SUPPORTED_CURRENCIES.has("USD")).toBe(true)
  })
})

describe("convertShipmentCurrency", () => {
  const base = (over: Partial<CreateShipmentInput> = {}): CreateShipmentInput => ({
    reference_id: "o1",
    payment_mode: "prepaid",
    pickup_location_name: "wh",
    currency: "THB",
    to: {
      name: "A B",
      phone: "1",
      address_1: "x",
      city: "Bangkok",
      state: "BKK",
      pincode: "10110",
      country: "TH",
    },
    items: [
      { name: "Scarf", sku: "S1", quantity: 2, unit_price: 100, hsn: "6214" },
      { name: "Shawl", sku: "S2", quantity: 1, unit_price: 355, hsn: "6214" },
    ],
    weight_grams: 600,
    sub_total: 555,
    ...over,
  })

  it("converts currency, sub_total and per-line unit_price at the rate, rounding to 2dp", () => {
    // 1 THB = 0.028 USD
    const out = convertShipmentCurrency(base(), "USD", 0.028)
    expect(out.currency).toBe("USD")
    expect(out.sub_total).toBe(15.54) // 555 * 0.028 = 15.54
    expect(out.items[0].unit_price).toBe(2.8) // 100 * 0.028
    expect(out.items[1].unit_price).toBe(9.94) // 355 * 0.028 = 9.94
    // Non-monetary line fields survive untouched.
    expect(out.items[0]).toMatchObject({ name: "Scarf", sku: "S1", quantity: 2, hsn: "6214" })
  })

  it("converts cod_amount when present and leaves it absent otherwise", () => {
    const withCod = convertShipmentCurrency(base({ cod_amount: 555 }), "USD", 0.028)
    expect(withCod.cod_amount).toBe(15.54)
    const withoutCod = convertShipmentCurrency(base(), "USD", 0.028)
    expect(withoutCod.cod_amount).toBeUndefined()
  })

  it("uppercases the target currency and is a pure copy (input untouched)", () => {
    const input = base()
    const out = convertShipmentCurrency(input, "usd", 0.028)
    expect(out.currency).toBe("USD")
    expect(input.currency).toBe("THB")
    expect(input.items[0].unit_price).toBe(100)
    expect(out).not.toBe(input)
  })
})
