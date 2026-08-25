import { planFreightOptionData } from "../backfill-freight-option-data-job"

/**
 * The decision this guards: which live shipping options are missing the freight
 * `data` that decides what a buyer is charged when no carrier will quote.
 *
 * Getting it wrong in one direction leaves a EUR lane resolving to 200 — €200
 * against an intended €35, silently, at checkout. Getting it wrong in the other
 * overwrites an amount a human deliberately researched, which is worse, because
 * it looks like the job worked.
 */

const TIERS = [
  { max_weight_grams: 5000, amounts: { eur: 59 } },
  { max_weight_grams: null, amounts: { eur: 100 } },
]
const INTL_FALLBACK = { eur: 35, inr: 3200 }

const plan = (zones: any[], over: any = {}) =>
  planFreightOptionData({
    fulfillmentSets: [{ id: "fs_1", type: "shipping", service_zones: zones }],
    homeCountry: "in",
    intlFallbackByCurrency: INTL_FALLBACK,
    domesticFallbackAmount: 200,
    tiers: TIERS,
    overwrite: false,
    createMissingQuoteTier: true,
    ...over,
  })

const shiprocket = (over: any = {}) => ({
  id: "so_sr",
  name: "International Shipping (Shiprocket)",
  provider_id: "shiprocket_shiprocket",
  price_type: "calculated",
  rules: [{ attribute: "enabled_in_store", value: "true" }],
  ...over,
})

const quoteOnly = (over: any = {}) => ({
  id: "so_tier",
  name: "Quote Freight — tiered",
  provider_id: "manual_manual",
  price_type: "flat",
  rules: [
    { attribute: "enabled_in_store", value: "false" },
    { attribute: "quote_only", value: "true" },
  ],
  ...over,
})

const intlZone = (options: any[]) => ({
  id: "sz_intl",
  name: "International Zone",
  geo_zones: [{ country_code: "nl" }, { country_code: "us" }],
  shipping_options: options,
})

const domesticZone = (options: any[]) => ({
  id: "sz_in",
  name: "IN Shipping Zone",
  geo_zones: [{ country_code: "in" }],
  shipping_options: options,
})

describe("planFreightOptionData", () => {
  it("stamps the per-currency map on an international Shiprocket option carrying no data", () => {
    const entries = plan([intlZone([shiprocket()])])
    const stamp = entries.find((e) => e.kind === "intl-fallback-amounts")

    expect(stamp).toBeDefined()
    expect(stamp!.option_id).toBe("so_sr")
    expect(stamp!.before).toBe("absent")
    // 🔴 The whole point: a map keyed by CURRENCY. The bug it replaces charged
    // €200 on a EUR cart because one number had to serve every currency.
    expect(stamp!.after).toEqual(INTL_FALLBACK)
  })

  it("stamps the scalar fallback on a DOMESTIC Shiprocket option, not the map", () => {
    const entries = plan([domesticZone([shiprocket({ id: "so_dom" })])])

    expect(entries.map((e) => e.kind)).toEqual(["domestic-fallback-amount"])
    expect(entries[0].after).toBe(200)
  })

  it("is idempotent — an option already carrying the key is left alone", () => {
    const entries = plan([
      intlZone([shiprocket({ data: { flat_fallback_amounts: { eur: 35 } } })]),
      // and the quote-only option exists, so nothing is created either
    ])

    expect(entries.filter((e) => e.kind === "intl-fallback-amounts")).toHaveLength(0)
  })

  it("does NOT revert an operator's edited amount", () => {
    // Someone researched the lane and set €12. A sweep that restored the €35
    // placeholder would look like it worked and quietly undo a real decision.
    const entries = plan([
      intlZone([
        shiprocket({ data: { flat_fallback_amounts: { eur: 12 } } }),
        quoteOnly({ data: { quote_weight_tiers: TIERS } }),
      ]),
    ])

    expect(entries).toHaveLength(0)
  })

  it("restamps an edited amount only when overwrite is asked for", () => {
    const entries = plan(
      [intlZone([shiprocket({ data: { flat_fallback_amounts: { eur: 12 } } }), quoteOnly({ data: { quote_weight_tiers: TIERS } })])],
      { overwrite: true }
    )

    const stamp = entries.find((e) => e.kind === "intl-fallback-amounts")!
    expect(stamp.before).toEqual({ eur: 12 })
    expect(stamp.after).toEqual(INTL_FALLBACK)
  })

  it("treats an EMPTY data key as absent", () => {
    // `{}` is what a half-finished edit leaves behind. Counting it as
    // configured would report the store current while the lane still resolves
    // to 200 forever.
    const entries = plan([intlZone([shiprocket({ data: { flat_fallback_amounts: {} } })])])

    expect(entries.some((e) => e.kind === "intl-fallback-amounts")).toBe(true)
  })

  it("creates the missing quote-only tiered option in an international zone", () => {
    const entries = plan([intlZone([shiprocket({ data: { flat_fallback_amounts: { eur: 35 } } })])])

    expect(entries.map((e) => e.kind)).toEqual(["quote-tier-option"])
    expect(entries[0].option_id).toBeUndefined()
    expect(entries[0].zone_id).toBe("sz_intl")
  })

  it("never creates a SECOND quote-only option when one already exists", () => {
    const entries = plan([
      intlZone([shiprocket({ data: { flat_fallback_amounts: { eur: 35 } } }), quoteOnly({ data: { quote_weight_tiers: TIERS } })]),
    ])

    expect(entries).toHaveLength(0)
  })

  it("recognises the quote-only option by its RULE, not by its name", () => {
    // Names are hand-editable; several zones were renamed by hand during #954.
    const entries = plan([
      intlZone([quoteOnly({ name: "Pallet rate (renamed by hand)", data: { quote_weight_tiers: TIERS } })]),
    ])

    expect(entries.some((e) => e.kind === "quote-tier-option")).toBe(false)
  })

  it("stamps tiers onto a quote-only option that has the rule but no table", () => {
    // A half-configured option: marked quote-only, priced from a table that
    // isn't there. The resolver refuses it, so the tier rung silently vanishes.
    const entries = plan([intlZone([shiprocket({ data: { flat_fallback_amounts: { eur: 35 } } }), quoteOnly()])])

    expect(entries.map((e) => e.kind)).toEqual(["quote-tier-data"])
    expect(entries[0].after).toEqual(TIERS)
  })

  it("never creates a quote tier in a DOMESTIC zone", () => {
    const entries = plan([domesticZone([shiprocket({ id: "so_dom", data: { flat_fallback_amount: 200 } })])])

    expect(entries).toHaveLength(0)
  })

  it("leaves manual and DHL options alone — nothing reads these keys off them", () => {
    const entries = plan([
      intlZone([
        { id: "so_man", name: "International Shipping", provider_id: "manual_manual", price_type: "flat", rules: [] },
        { id: "so_dhl", name: "DHL Express", provider_id: "dhl-express_dhl-express", price_type: "calculated", data: { product_code: "P" }, rules: [] },
        quoteOnly({ data: { quote_weight_tiers: TIERS } }),
      ]),
    ])

    expect(entries).toHaveLength(0)
  })

  it("skips pickup fulfillment sets entirely", () => {
    const entries = planFreightOptionData({
      fulfillmentSets: [{ id: "fs_pickup", type: "pickup", service_zones: [intlZone([shiprocket()])] }],
      homeCountry: "in",
      intlFallbackByCurrency: INTL_FALLBACK,
      domesticFallbackAmount: 200,
      tiers: TIERS,
      overwrite: false,
      createMissingQuoteTier: true,
    })

    expect(entries).toHaveLength(0)
  })

  it("decides international from the geo zones, not the zone's name", () => {
    const entries = plan([
      {
        id: "sz_x",
        name: "Zone 3",
        geo_zones: [{ country_code: "de" }],
        shipping_options: [shiprocket(), quoteOnly({ data: { quote_weight_tiers: TIERS } })],
      },
    ])

    expect(entries.map((e) => e.kind)).toEqual(["intl-fallback-amounts"])
  })

  it("can be told not to create the quote tier", () => {
    const entries = plan([intlZone([shiprocket({ data: { flat_fallback_amounts: { eur: 35 } } })])], {
      createMissingQuoteTier: false,
    })

    expect(entries).toHaveLength(0)
  })
})
