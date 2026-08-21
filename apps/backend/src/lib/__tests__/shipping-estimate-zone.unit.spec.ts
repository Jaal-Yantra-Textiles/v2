import { zoneCoversDestination } from "../shipping-estimate"
import { pickFreightOption } from "../../modules/partner-quote/lib/build-quote-view"

/**
 * Found on a LIVE production mint (#1389 S3 verification, 21 Aug):
 *
 *   destination : Mumbai 400001, domestic, 21 kg
 *   currency    : inr
 *   freight won : "European Shipping", amount 10, currency AUD
 *
 * Two independent defects let that happen. `buildShippingEstimate` collected
 * manual options from EVERY service zone on the location regardless of whether
 * the zone covered the destination, and it kept options in ANY currency — while
 * `pickFreightOption` sorts on the raw `amount`. So 10 AUD beat a rupee rate on
 * the number alone, and was then rendered as Rs 10.
 */

describe("zoneCoversDestination", () => {
  it("rejects a zone that does not cover the destination", () => {
    // The live case: a European zone offered for an Indian delivery.
    const european = { geo_zones: [{ country_code: "de" }, { country_code: "fr" }] }
    expect(zoneCoversDestination(european, "in")).toBe(false)
  })

  it("accepts a zone that covers it, case-insensitively", () => {
    expect(zoneCoversDestination({ geo_zones: [{ country_code: "IN" }] }, "in")).toBe(
      true
    )
  })

  it("accepts a multi-country international zone containing the destination", () => {
    const intl = { geo_zones: [{ country_code: "us" }, { country_code: "gb" }] }
    expect(zoneCoversDestination(intl, "gb")).toBe(true)
  })

  it("treats a zone with NO geo zones as covering NOTHING", () => {
    // An unscoped zone is a provisioning accident. Reading it as "worldwide" is
    // how one bad row ends up pricing every lane.
    expect(zoneCoversDestination({ geo_zones: [] }, "in")).toBe(false)
    expect(zoneCoversDestination(null, "in")).toBe(false)
  })

  it("refuses when the destination itself is unknown", () => {
    expect(zoneCoversDestination({ geo_zones: [{ country_code: "in" }] }, "")).toBe(
      false
    )
  })
})

describe("pickFreightOption — the currency trap it cannot see", () => {
  it("picks the cheapest, comparing raw amounts", () => {
    // This is the DOCUMENTED behaviour and it is fine — as long as every option
    // reaching it is already in one currency. That precondition is the fix;
    // this test pins why the precondition matters.
    const chosen = pickFreightOption({
      manual: [
        { amount: 200, currency_code: "inr", source: "manual" } as any,
        { amount: 10, currency_code: "aud", source: "manual" } as any,
      ],
      calculated: [],
    })

    // 10 AUD "wins" on the number alone — roughly 30x more expensive in truth.
    // Nothing downstream can detect this, which is why the filtering has to
    // happen before the picker ever sees it.
    expect(chosen!.currency_code).toBe("aud")
  })

  it("is correct once every option shares the quote's currency", () => {
    const chosen = pickFreightOption({
      manual: [
        { amount: 200, currency_code: "inr", source: "manual" } as any,
        { amount: 450, currency_code: "inr", source: "manual" } as any,
      ],
      calculated: [],
    })
    expect(chosen!.amount).toBe(200)
  })
})
