import {
  PartnerProductSpecReq,
} from "../validators"

/**
 * Request-shape rules for the product-spec route (#1342).
 *
 * Range checking is NOT here on purpose — whether 900 GSM is a typo depends on
 * the technique, so it lives in the workflow (see
 * `modules/product-spec/__tests__/weaving-techniques.unit.spec.ts`). What this
 * covers is the boundary the route itself owns.
 */
describe("PartnerProductSpecReq", () => {
  it("accepts an empty body — every field is optional", () => {
    expect(PartnerProductSpecReq.safeParse({}).success).toBe(true)
  })

  it("accepts a full spec", () => {
    const parsed = PartnerProductSpecReq.safeParse({
      weave_technique: "pashmina-plain",
      weave_label: "Handspun, handwoven pashmina",
      params: { gsm: 85, ends_per_inch: 72 },
      finishes: ["hand wash cold", "dry flat"],
      notes: "Warp tension eases in monsoon.",
      accepting_custom_orders: true,
      custom_order_lead_time_days: 45,
      colors: [
        { name: "Kashmiri walnut", hex_code: "#5B4636", order: 0 },
        { name: "Undyed", hex_code: null, usage_notes: "Body only" },
      ],
      fields: [{ key: "pallu_type", label: "Pallu type", value: "Woven" }],
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects a colour that isn't a hex value", () => {
    const parsed = PartnerProductSpecReq.safeParse({
      colors: [{ name: "Walnut", hex_code: "walnut brown" }],
    })
    expect(parsed.success).toBe(false)
  })

  it("accepts shorthand hex and a bare hex, with or without the hash", () => {
    for (const hex of ["#abc", "abc", "#C9A227", "c9a227"]) {
      expect(
        PartnerProductSpecReq.safeParse({ colors: [{ name: "x", hex_code: hex }] })
          .success
      ).toBe(true)
    }
  })

  it("rejects a colour with no name — an unnamed colour cannot be chosen", () => {
    expect(
      PartnerProductSpecReq.safeParse({ colors: [{ name: "   " }] }).success
    ).toBe(false)
  })

  it("rejects unknown keys rather than silently dropping them", () => {
    // .strict() matters here: a typo'd key that parsed would be discarded on
    // write and the partner would be told the save succeeded.
    expect(
      PartnerProductSpecReq.safeParse({ weave_techinque: "ikat" }).success
    ).toBe(false)
  })

  it("requires params to be numeric", () => {
    expect(
      PartnerProductSpecReq.safeParse({ params: { gsm: "heavy" } }).success
    ).toBe(false)
  })

  it("distinguishes an omitted palette from an emptied one", () => {
    // Both are valid requests, and they mean different things downstream:
    // omitted leaves the palette alone, [] deletes every entry.
    const omitted = PartnerProductSpecReq.safeParse({ notes: "x" })
    const emptied = PartnerProductSpecReq.safeParse({ colors: [] })
    expect(omitted.success && emptied.success).toBe(true)
    expect((omitted as any).data.colors).toBeUndefined()
    expect((emptied as any).data.colors).toEqual([])
  })

  it("caps the palette and the custom fields", () => {
    const colors = Array.from({ length: 61 }, (_, i) => ({ name: `c${i}` }))
    expect(PartnerProductSpecReq.safeParse({ colors }).success).toBe(false)

    const fields = Array.from({ length: 41 }, (_, i) => ({ key: `k${i}` }))
    expect(PartnerProductSpecReq.safeParse({ fields }).success).toBe(false)
  })

  it("allows null to clear a field", () => {
    const parsed = PartnerProductSpecReq.safeParse({
      weave_technique: null,
      weave_label: null,
      params: null,
      notes: null,
      custom_order_lead_time_days: null,
    })
    expect(parsed.success).toBe(true)
  })
})
