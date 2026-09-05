import {
  DTDC_COMMODITIES,
  DTDC_DEFAULT_COMMODITY_ID,
  resolveDtdcCommodityId,
} from "../lib/commodities"

/**
 * `commodity_id` is a declaration on a shipping document, not a tuning knob.
 *
 * The wire default was `"2"`, which DTDC's own commodity list calls MOBILE. On
 * a textile platform every waybill booked without an explicit value declared a
 * mobile phone, and nothing surfaced it: DTDC accepts the booking, the label
 * prints, only the paperwork is wrong.
 */
describe("resolveDtdcCommodityId", () => {
  it("no longer defaults to MOBILE", () => {
    expect(DTDC_DEFAULT_COMMODITY_ID).not.toBe("2")
    expect(DTDC_DEFAULT_COMMODITY_ID).toBe(DTDC_COMMODITIES.CLOTHING)
  })

  it("takes a raw id straight from DTDC's sheet", () => {
    expect(resolveDtdcCommodityId("56")).toBe("56")
    expect(resolveDtdcCommodityId(" 38 ")).toBe("38")
  })

  it("takes a readable name so config does not need a lookup", () => {
    expect(resolveDtdcCommodityId("CLOTHING")).toBe("38")
    expect(resolveDtdcCommodityId("clothing")).toBe("38")
    expect(resolveDtdcCommodityId("unstitched fabric or saree")).toBe("56")
    expect(resolveDtdcCommodityId("leather-goods")).toBe("152")
  })

  /**
   * The list is DTDC's and grows. Refusing an id this file has not been updated
   * for would be worse than passing it through — but a NAME we do not know is a
   * typo, and a typo must not become a made-up id on a waybill.
   */
  it("passes through an id it does not know, but refuses an unknown name", () => {
    expect(resolveDtdcCommodityId("9999")).toBe("9999")
    expect(resolveDtdcCommodityId("SILK_SAREES")).toBeNull()
    expect(resolveDtdcCommodityId("clohting")).toBeNull()
  })

  it("returns null for nothing, so the caller falls back deliberately", () => {
    expect(resolveDtdcCommodityId(undefined)).toBeNull()
    expect(resolveDtdcCommodityId(null)).toBeNull()
    expect(resolveDtdcCommodityId("")).toBeNull()
    expect(resolveDtdcCommodityId("   ")).toBeNull()
  })

  it("keeps the textile ids that were read off DTDC's sheet", () => {
    expect(DTDC_COMMODITIES.CLOTHING).toBe("38")
    expect(DTDC_COMMODITIES.UNSTITCHED_FABRIC_OR_SAREE).toBe("56")
  })
})
