import {
  isQuotableShippingOption,
  zoneCoversDestination,
} from "../shipping-estimate"
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

describe("isQuotableShippingOption — the return row that won by being cheap", () => {
  it("🔴 refuses a RETURN option", () => {
    // `create-store-with-defaults` gives every store a flat "Return Shipping"
    // option at ₹100 against a ₹200 base. The picker sorts on the raw amount,
    // so it became the cheapest offer on every domestic Indian lane and quotes
    // were freighted at the return-pickup rate.
    expect(
      isQuotableShippingOption({
        name: "Return Shipping",
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "true", operator: "eq" },
        ],
      })
    ).toBe(false)
  })

  it("refuses one typed as a return even without the rule", () => {
    expect(
      isQuotableShippingOption({ name: "Returns", type: { code: "return" } })
    ).toBe(false)
  })

  it("refuses an option the store has switched off", () => {
    expect(
      isQuotableShippingOption({
        name: "Seasonal",
        rules: [{ attribute: "enabled_in_store", value: "false", operator: "eq" }],
      })
    ).toBe(false)
  })

  it("keeps an ordinary outbound option", () => {
    expect(
      isQuotableShippingOption({
        name: "Standard",
        rules: [{ attribute: "enabled_in_store", value: "true", operator: "eq" }],
      })
    ).toBe(true)
  })

  it("keeps an option with no rules — absence is not a prohibition", () => {
    // Most hand-made options carry none, and dropping those would empty the
    // lane entirely, which is a worse failure than the one being fixed.
    expect(isQuotableShippingOption({ name: "Flat rate" })).toBe(true)
    expect(isQuotableShippingOption({ name: "Flat rate", rules: [] })).toBe(true)
  })
})

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

describe("pickFreightOption — a calculated winner still needs a lane (#1498)", () => {
  it("🔴 borrows the shipping_option_id from a manual option on the lane", () => {
    // A carrier rate is a courier and a price, not a Medusa shipping option.
    // Acceptance mints the cart's freight option in the service zone of the
    // option the quote was rated against and REFUSES when none was frozen — so
    // without this, every quote won by a live rate priced fine and could not be
    // bought. It stayed hidden while cross-border lanes fell to the flat
    // fallback; #1498 makes carrier rates win them for the first time.
    const chosen = pickFreightOption({
      manual: [
        {
          shipping_option_id: "so_intl",
          amount: 3500,
          currency_code: "inr",
          source: "manual",
        } as any,
      ],
      calculated: [
        {
          courier_name: "SRX Economy",
          amount: 1482,
          currency_code: "inr",
          source: "calculated",
        } as any,
      ],
    })

    expect(chosen!.amount).toBe(1482)
    expect(chosen!.source).toBe("calculated")
    // The ZONE is borrowed, never the price.
    expect(chosen!.shipping_option_id).toBe("so_intl")
  })

  it("leaves the id null when the store has no lane at all, so acceptance can say so", () => {
    // The honest answer: the store genuinely has no configured option to that
    // country, which is the refusal #1497 wrote. Inventing an id here would
    // charge the freight on somebody else's zone.
    const chosen = pickFreightOption({
      manual: [],
      calculated: [
        { amount: 1482, currency_code: "inr", source: "calculated" } as any,
      ],
    })
    expect(chosen!.shipping_option_id).toBeUndefined()
  })

  it("does not overwrite an id the winner already has", () => {
    const chosen = pickFreightOption({
      manual: [
        {
          shipping_option_id: "so_cheap",
          amount: 200,
          currency_code: "inr",
          source: "manual",
        } as any,
        {
          shipping_option_id: "so_other",
          amount: 900,
          currency_code: "inr",
          source: "manual",
        } as any,
      ],
      calculated: [],
    })
    expect(chosen!.shipping_option_id).toBe("so_cheap")
  })
})
