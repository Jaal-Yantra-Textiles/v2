import { planShiprocketOptions } from "../backfill-shiprocket-shipping-options-job"

/**
 * The decision this guards: "does this store already have Shiprocket on this
 * zone". Getting it wrong duplicates a carrier in a LIVE checkout picker, and
 * `createShippingOptions` will happily make the duplicate without complaint.
 */

const zone = (over: any = {}) => ({
  id: "sz_1",
  name: "IN Shipping Zone",
  geo_zones: [{ country_code: "in" }],
  shipping_options: [],
  ...over,
})

const sets = (zones: any[]) => [{ id: "fs_1", type: "shipping", service_zones: zones }]

describe("planShiprocketOptions", () => {
  it("adds the calculated Shiprocket option and a flat companion to a bare domestic zone", () => {
    const plan = planShiprocketOptions({
      fulfillmentSets: sets([
        zone({
          shipping_options: [
            { provider_id: "delhivery_delhivery", price_type: "calculated" },
          ],
        }),
      ]),
      homeCountry: "in",
    })

    expect(plan.map((p) => p.kind).sort()).toEqual([
      "domestic-calculated",
      "domestic-flat",
    ])
  })

  it("is idempotent — a zone that already has Shiprocket gets no second one", () => {
    const plan = planShiprocketOptions({
      fulfillmentSets: sets([
        zone({
          shipping_options: [
            { provider_id: "shiprocket_shiprocket", price_type: "calculated" },
            { provider_id: "manual_manual", price_type: "flat" },
          ],
        }),
      ]),
      homeCountry: "in",
    })

    expect(plan).toEqual([])
  })

  it("does not add a second flat option when the store already has flat tiers", () => {
    const plan = planShiprocketOptions({
      fulfillmentSets: sets([
        zone({
          shipping_options: [{ provider_id: "manual_manual", price_type: "flat" }],
        }),
      ]),
      homeCountry: "in",
    })

    expect(plan.map((p) => p.kind)).toEqual(["domestic-calculated"])
  })

  it("classifies a zone as international from its GEO ZONES, not its name", () => {
    // Several zones were renamed by hand during the #954 backfill, so matching
    // on the name "International" would silently skip them.
    const plan = planShiprocketOptions({
      fulfillmentSets: sets([
        zone({
          id: "sz_intl",
          name: "Renamed By Hand",
          geo_zones: [{ country_code: "us" }, { country_code: "gb" }],
        }),
      ]),
      homeCountry: "in",
    })

    expect(plan).toEqual([
      {
        zone_id: "sz_intl",
        zone_name: "Renamed By Hand",
        kind: "international-calculated",
        provider_id: "shiprocket_shiprocket",
      },
    ])
  })

  it("never puts a flat companion on an international zone", () => {
    const plan = planShiprocketOptions({
      fulfillmentSets: sets([
        zone({ id: "sz_intl", geo_zones: [{ country_code: "us" }] }),
      ]),
      homeCountry: "in",
    })

    expect(plan.some((p) => p.kind === "domestic-flat")).toBe(false)
  })

  it("skips PICKUP sets — a courier cannot deliver a parcel being collected", () => {
    const plan = planShiprocketOptions({
      fulfillmentSets: [{ id: "fs_p", type: "pickup", service_zones: [zone()] }],
      homeCountry: "in",
    })

    expect(plan).toEqual([])
  })

  it("skips a zone with no geo zones at all", () => {
    const plan = planShiprocketOptions({
      fulfillmentSets: sets([zone({ geo_zones: [] })]),
      homeCountry: "in",
    })

    expect(plan).toEqual([])
  })
})
