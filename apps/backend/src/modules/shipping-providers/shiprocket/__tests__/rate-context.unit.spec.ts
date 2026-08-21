import {
  deriveShiprocketRateContext,
  resolveConsignmentDimensions,
  resolveConsignmentWeightGrams,
} from "../rate-context"

/**
 * The defect these guard (#1417): `calculatePrice` required a 6-digit PIN on
 * BOTH ends and never passed `destination_country`, so every cross-border cart
 * was quoted 0 — free international shipping, shaped exactly like a real quote.
 *
 * 🔑 An assertion that cannot tell success from failure is not a test. The
 * cross-border cases below assert on `destination_country` being POPULATED, not
 * merely that a context came back: the old code would have produced a context
 * too, just a domestic one aimed at the wrong endpoint.
 */

const ctx = (over: any = {}) => ({
  from_location: { address: { postal_code: "110001" } },
  shipping_address: { postal_code: "400001", country_code: "IN" },
  items: [],
  ...over,
})

describe("deriveShiprocketRateContext", () => {
  it("quotes a domestic lane without a destination country", () => {
    const { context, reason } = deriveShiprocketRateContext(ctx())

    expect(reason).toBeUndefined()
    expect(context).toMatchObject({
      origin_pincode: "110001",
      destination_pincode: "400001",
      international: false,
    })
    // Must stay undefined domestically — the client reaches for its cross-border
    // product on the PRESENCE of a foreign country, not on the string "IN".
    expect(context!.destination_country).toBeUndefined()
  })

  it("quotes a cross-border lane whose postcode is not a 6-digit PIN", () => {
    // The regression: "SW1A 1AA" fails /^\d{6}$/, which is exactly how every
    // international cart used to fall through to a silent 0.
    const { context, reason } = deriveShiprocketRateContext(
      ctx({ shipping_address: { postal_code: "SW1A 1AA", country_code: "gb" } })
    )

    expect(reason).toBeUndefined()
    expect(context!.international).toBe(true)
    // Uppercased, because Shiprocket's `delivery_country` expects ISO2 upper.
    expect(context!.destination_country).toBe("GB")
  })

  it("quotes a cross-border lane with NO postcode at all", () => {
    const { context } = deriveShiprocketRateContext(
      ctx({ shipping_address: { country_code: "AE" } })
    )

    expect(context!.destination_country).toBe("AE")
    expect(context!.destination_pincode).toBe("")
  })

  it("refuses a domestic lane whose destination pincode is malformed", () => {
    const { context, reason } = deriveShiprocketRateContext(
      ctx({ shipping_address: { postal_code: "40001", country_code: "IN" } })
    )

    expect(context).toBeUndefined()
    expect(reason).toContain("40001")
  })

  it("treats an absent country as domestic and holds it to the PIN shape", () => {
    // A missing country must not be quoted as if it were a local lane, and must
    // not silently take the cross-border branch either.
    const { context, reason } = deriveShiprocketRateContext(
      ctx({ shipping_address: { postal_code: "SW1A 1AA" } })
    )

    expect(context).toBeUndefined()
    expect(reason).toContain("6-digit")
  })

  it("refuses when the ORIGIN has no valid pincode, in both modes", () => {
    for (const shipping_address of [
      { postal_code: "400001", country_code: "IN" },
      { postal_code: "SW1A 1AA", country_code: "GB" },
    ]) {
      const { context, reason } = deriveShiprocketRateContext(
        ctx({ from_location: { address: { postal_code: "" } }, shipping_address })
      )

      // The international endpoint 400s without `pickup_postcode`, so the origin
      // is required cross-border too — not just domestically.
      expect(context).toBeUndefined()
      expect(reason).toContain("pickup location")
    }
  })
})

describe("resolveConsignmentWeightGrams", () => {
  it("sums variant weight × quantity", () => {
    expect(
      resolveConsignmentWeightGrams([
        { quantity: 2, variant: { weight: 300 } },
        { quantity: 1, variant: { weight: 150 } },
      ])
    ).toBe(750)
  })

  it("falls back to the PRODUCT weight when the variant has none", () => {
    // 140 of 183 variants platform-wide carry no weight of their own, so this
    // is the common path, not the edge case.
    expect(
      resolveConsignmentWeightGrams([
        { quantity: 3, variant: { product: { weight: 100 } } },
      ])
    ).toBe(300)
  })

  it("estimates rather than refusing when nothing carries a weight", () => {
    // Unlike the quote builder, which refuses: a cart must stay checkout-able.
    expect(resolveConsignmentWeightGrams([{ quantity: 3, variant: {} }])).toBe(1200)
    expect(resolveConsignmentWeightGrams([])).toBe(400)
  })
})

describe("resolveConsignmentDimensions", () => {
  it("stacks: widest footprint, summed height — matching createFulfillment", () => {
    // Deriving the quote box differently from the SHIPMENT box would price a
    // parcel we never send.
    expect(
      resolveConsignmentDimensions([
        { quantity: 2, variant: { length: 30, width: 20, height: 5 } },
        { quantity: 1, variant: { length: 10, width: 25, height: 4 } },
      ])
    ).toEqual({ length: 30, width: 25, height: 14 })
  })

  it("returns undefined when no item carries a complete box", () => {
    // A fabricated box is worse than none: the carrier prices it as fact, and
    // international couriers charge on volumetric weight.
    expect(
      resolveConsignmentDimensions([{ quantity: 1, variant: { length: 30, width: 20 } }])
    ).toBeUndefined()
    expect(resolveConsignmentDimensions([])).toBeUndefined()
  })
})
