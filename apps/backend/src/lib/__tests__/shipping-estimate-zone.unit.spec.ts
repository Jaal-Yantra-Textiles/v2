import {
  isQuotableShippingOption,
  zoneCoversDestination,
} from "../shipping-estimate"
import { pickFreightOption } from "../../modules/partner-quote/lib/build-quote-view"
import {
  QUOTE_FREIGHT_OPTION_RULE_ATTRIBUTE,
  QUOTE_FREIGHT_OPTION_TYPE_CODE,
  quoteFreightOptionName,
} from "../../modules/partner-quote/lib/quote-freight-option"

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

/**
 * 🔴 ONE BUYER'S NEGOTIATED FREIGHT IS NEVER AN OFFER TO ANOTHER (#1527).
 *
 * Accepting a quote mints a flat option priced at that quote's frozen freight,
 * ruled `quote_id eq <id>`. That rule hides it from other CARTS — core's rule
 * engine does the hiding, via `hooks/quote-shipping-options-context.ts`. This
 * estimate never goes near core's rule engine: it reads a location's options
 * straight out of `query.graph`. So every per-quote option ever minted stood
 * here as an ordinary candidate for unrelated quotes.
 *
 * Live on prod 25 Aug, in one store:
 *
 *   Quoted freight — 01M0Q7T0…   35 eur
 *   Quoted freight — 01M0QF8C…   99 inr   ← wins ANY inr quote
 *   Quoted freight — 01M0QGQ4…   48.5 eur
 *
 * all three from REVOKED quotes, two already surfaced on a real customer's
 * quote. `pickFreightOption` sorts on the raw amount, so ₹99 beats every real
 * rate on every INR lane regardless of weight, lane or destination.
 *
 * 🔑 Fourth instance of one shape — zone-blind (#1424), rule-blind (#1430),
 * the return row (#1485), and now this: a row nobody chose for *this* shipment
 * winning it by being small.
 *
 * The refusal lives in the callee. Deleting the option on revoke (which
 * `revokeQuote` now also does) would still leave a LIVE quote's freight
 * standing as a candidate for the next buyer, and would depend on every future
 * path that kills a quote remembering to clean up.
 */
describe("isQuotableShippingOption — one buyer's freight is not another's offer", () => {
  it("🔴 refuses an option scoped to a quote by its rule", () => {
    expect(
      isQuotableShippingOption({
        name: quoteFreightOptionName("01M0QF8CN2S0TPA0HTKD0YHGJ7"),
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          {
            attribute: QUOTE_FREIGHT_OPTION_RULE_ATTRIBUTE,
            value: "01M0QF8CN2S0TPA0HTKD0YHGJ7",
            operator: "eq",
          },
        ],
      })
    ).toBe(false)
  })

  /**
   * The rule is refused whatever quote it names and whatever the quote's state
   * — there is deliberately no "is this quote still alive?" test. A live
   * quote's freight is exactly as wrong an answer for a different buyer as a
   * dead one's, and it is the LIVE case a teardown could never reach.
   */
  it("🔴 refuses it for a live quote too, not only an abandoned one", () => {
    expect(
      isQuotableShippingOption({
        name: "Quoted freight — some_active_quote",
        rules: [
          {
            attribute: QUOTE_FREIGHT_OPTION_RULE_ATTRIBUTE,
            value: "some_active_quote",
            operator: "eq",
          },
        ],
      })
    ).toBe(false)
  })

  /**
   * Belt and braces, and the belt was DEAD until #1527: the estimate's query
   * never asked for `shipping_options.type`, so this read a field that could
   * not arrive — on the return check too. Absence in the instrument, not in
   * the world; the same reading error as #1528. The field is fetched now, so
   * the type code has to be honoured.
   */
  it("refuses one carrying only the quoted-freight type code", () => {
    expect(
      isQuotableShippingOption({
        name: "Quoted freight — x",
        type: { code: QUOTE_FREIGHT_OPTION_TYPE_CODE },
      })
    ).toBe(false)
  })

  /**
   * 🔴 The store's OWN flat option must survive. It is the donor lane every
   * quote to that country is rated against and frozen onto; refusing it would
   * take the lane down for every quote at once — a far worse failure than the
   * leak being fixed. Only the `quote_id` rule and the minted type code
   * disqualify an option, never the word "freight" in its name.
   */
  it("keeps the store's own configured option, however it is named", () => {
    expect(
      isQuotableShippingOption({
        name: "International Shipping · 68M3HY2V",
        rules: [{ attribute: "enabled_in_store", value: "true", operator: "eq" }],
        type: { code: "international-shipping-68m3hy2v" },
      })
    ).toBe(true)
    // Named confusingly, but carrying neither disqualifier.
    expect(isQuotableShippingOption({ name: "Freight (quoted)" })).toBe(true)
  })
})

/**
 * The option's name is an IDENTIFIER, not a label (#1527).
 *
 * `revokeQuote`'s teardown finds the option by this exact string, so the
 * minting step and the teardown must never be able to disagree about it — and
 * a mismatch would be invisible, because a teardown that matches nothing does
 * not fail. Hence one constructor, pinned here.
 */
describe("quoteFreightOptionName", () => {
  it("is the exact string acceptance mints and revoke looks for", () => {
    expect(quoteFreightOptionName("01M0QF8CN2S0TPA0HTKD0YHGJ7")).toBe(
      "Quoted freight — 01M0QF8CN2S0TPA0HTKD0YHGJ7"
    )
    // An em dash, not a hyphen. An exact-match filter does not forgive it.
    expect(quoteFreightOptionName("q_1")).toContain("—")
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
