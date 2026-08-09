import { buildInternationalCreateBody, stripIsdPrefix } from "../client"

/**
 * Shiprocket sends the dial code as its own `isd_code` field and concatenates it
 * onto the phone, so a phone stored in E.164 came out doubled on the label and
 * the commercial invoice — observed in prod as `+972-+972548043774`.
 */
describe("stripIsdPrefix", () => {
  it("strips an E.164 prefix that duplicates the isd_code", () => {
    expect(stripIsdPrefix("+972548043774", "+972")).toBe("548043774")
  })

  it("strips the 00-style international prefix too", () => {
    expect(stripIsdPrefix("00972548043774", "+972")).toBe("548043774")
  })

  it("drops a trunk 0 left behind after the dial code", () => {
    expect(stripIsdPrefix("+972-0-54-804-3774", "+972")).toBe("548043774")
  })

  it("leaves a national number alone", () => {
    expect(stripIsdPrefix("548043774", "+972")).toBe("548043774")
  })

  it("keeps a bare number that merely starts with the dial digits", () => {
    // 9723... is a legitimate local number in several plans; truncating a good
    // phone is worse than a cosmetic doubling, so only an explicit +/00 counts.
    expect(stripIsdPrefix("9723456789", "+972")).toBe("9723456789")
  })

  it("normalises presentational separators", () => {
    expect(stripIsdPrefix("+1 (415) 555-0132", "+1")).toBe("4155550132")
  })

  it("never returns empty when given a number", () => {
    // A blank phone fails two calls later at AWB assign with a misleading
    // "Delivery pincode is empty" — always better to send something.
    expect(stripIsdPrefix("+972", "+972")).toBe("+972")
  })

  it("handles an absent phone", () => {
    expect(stripIsdPrefix(undefined, "+972")).toBe("")
    expect(stripIsdPrefix("", "+972")).toBe("")
  })
})

describe("buildInternationalCreateBody phone handling", () => {
  const input: any = {
    reference_id: "gtrf_test",
    payment_mode: "prepaid",
    weight_grams: 500,
    sub_total: 100,
    to: {
      name: "Yael Cohen",
      address_1: "12 Rothschild Blvd",
      city: "Tel Aviv",
      pincode: "6688218",
      country: "IL",
      phone: "+972548043774",
      email: "buyer@example.com",
    },
    items: [
      {
        name: "Embroidered jacket",
        sku: "JKT-1",
        quantity: 1,
        unit_price: 100,
        hsn: "62031200",
      },
    ],
    customs: { reason_for_export: "SALE" },
  }

  it("sends the dial code and the national number as separate, non-overlapping fields", () => {
    const body = buildInternationalCreateBody(input, "warehouse-A1DT5PM1")

    expect(body.isd_code).toBe("+972")
    expect(body.billing_phone).toBe("548043774")
    expect(body.shipping_phone).toBe("548043774")
    // The prod defect: the two fields concatenated to +972-+972548043774.
    expect(body.billing_phone).not.toContain("+972")
    expect(body.shipping_phone).not.toContain("+972")
  })
})
