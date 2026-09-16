import { parseRateQuery, pickRatesPickup } from "../shiprocket-rates"
import type { PickupLocation } from "../../../modules/shipping-providers/provider-interface"

/**
 * #641 — `pickRatesPickup` decides which registered Shiprocket pickup to quote
 * the rate FROM: prefer the pickup whose nickname matches the order's
 * fulfillment stock-location, else fall back to the shippable-first heuristic.
 */
describe("pickRatesPickup (#641)", () => {
  const p = (
    name: string,
    shippable?: boolean,
    pincode?: string
  ): PickupLocation => ({ name, shippable, pincode })

  it("returns undefined when there are no pickups", () => {
    expect(pickRatesPickup([])).toBeUndefined()
    expect(pickRatesPickup(undefined)).toBeUndefined()
    expect(pickRatesPickup(null)).toBeUndefined()
  })

  it("prefers the pickup matching the order's nickname", () => {
    const chosen = pickRatesPickup(
      [p("warehouse-a", true, "560001"), p("warehouse-b", false, "110001")],
      "warehouse-b"
    )
    expect(chosen?.name).toBe("warehouse-b")
    expect(chosen?.pincode).toBe("110001")
  })

  it("falls back to the shippable-first heuristic when the nickname does not match", () => {
    const chosen = pickRatesPickup(
      [p("warehouse-a", false), p("warehouse-b", true)],
      "warehouse-missing"
    )
    expect(chosen?.name).toBe("warehouse-b")
  })

  it("uses the heuristic when no preferred nickname is given", () => {
    const chosen = pickRatesPickup([
      p("warehouse-a", false),
      p("warehouse-b", true),
    ])
    expect(chosen?.name).toBe("warehouse-b")
  })

  it("falls back to the first pickup when none are shippable and nickname misses", () => {
    const chosen = pickRatesPickup(
      [p("warehouse-a", false), p("warehouse-b", false)],
      undefined
    )
    expect(chosen?.name).toBe("warehouse-a")
  })
})

/**
 * `parseRateQuery` — shared by every rate route so they accept the SAME
 * parameters. The per-route hand-parsing it replaces is how dimensions ended up
 * supported on the label call but not on the quote, which then priced a different
 * parcel than the one that shipped.
 */
describe("parseRateQuery", () => {
  it("reads weight, carrier and a full dimension set", () => {
    expect(
      parseRateQuery({
        carrier: "shiprocket",
        weight_grams: "1200",
        length_cm: "30",
        width_cm: "25",
        height_cm: "10",
      })
    ).toEqual({
      carrier: "shiprocket",
      weightGrams: 1200,
      dimensionsCm: { length: 30, width: 25, height: 10 },
    })
  })

  it("accepts the un-suffixed and `breadth` spellings the carrier uses", () => {
    expect(
      parseRateQuery({ length: "30", breadth: "25", height: "10" }).dimensionsCm
    ).toEqual({ length: 30, width: 25, height: 10 })
  })

  it.each([
    ["length missing", { width_cm: "25", height_cm: "10" }],
    ["width missing", { length_cm: "30", height_cm: "10" }],
    ["height missing", { length_cm: "30", width_cm: "25" }],
    ["one side blank", { length_cm: "30", width_cm: "", height_cm: "10" }],
    ["one side zero", { length_cm: "30", width_cm: "0", height_cm: "10" }],
    ["one side junk", { length_cm: "30", width_cm: "abc", height_cm: "10" }],
  ])("drops a partial box (%s) rather than guessing a side", (_l, query) => {
    // Inventing the missing side would silently change the quoted price.
    expect(parseRateQuery(query).dimensionsCm).toBeUndefined()
  })

  it("ignores non-positive or unparseable weights", () => {
    for (const weight_grams of ["0", "-5", "abc", "", null, undefined]) {
      expect(parseRateQuery({ weight_grams }).weightGrams).toBeUndefined()
    }
  })

  it("omits an empty carrier so the workflow default applies", () => {
    expect(parseRateQuery({ carrier: "" }).carrier).toBeUndefined()
    expect(parseRateQuery({}).carrier).toBeUndefined()
  })

  it("returns an all-undefined shape for an empty query", () => {
    expect(parseRateQuery({})).toEqual({
      carrier: undefined,
      weightGrams: undefined,
      dimensionsCm: undefined,
    })
  })
})

/**
 * 🔴 A carrier that rates by DESTINATION was refused for want of an origin.
 *
 * `getShiprocketRatesForOrder` calls `listPickupLocations` for exactly one
 * purpose — to derive an origin pincode — and then refuses to quote without
 * one. `listPickupLocations` is declared OPTIONAL on the provider interface
 * ("not every carrier exposes a list API"), so requiring it made an optional
 * method mandatory and turned a missing convenience into "does not support rate
 * quotes".
 *
 * ShipGlobal is the carrier that breaks on: `/rates/calculate` posts
 * `country_iso_code_2` + `postcode` and NOTHING about the origin, because the
 * origin is its own hub. Its checkout quote has always passed
 * `origin_pincode: ""` and returned real prices — so the same carrier priced
 * the same lane at checkout while the admin quote said it could not.
 *
 * Confirmed against production before the fix: quoting order #3's Switzerland
 * lane with carrier "shipglobal" returned
 *   400 "shipglobal provider does not support rate quotes"
 */
describe("rate quotes without an origin pincode", () => {
  const { getShiprocketRatesForOrder } = require("../shiprocket-rates")

  const order = {
    id: "order_1",
    shipping_address: { postal_code: "1054", country_code: "ch" },
    metadata: {},
  }

  /** A container whose query.graph answers the order lookup and nothing else. */
  const container = (provider: any) => ({
    resolve: (key: any) => {
      if (key === "query") {
        return {
          graph: async ({ entity }: any) =>
            entity === "order" || entity === "orders"
              ? { data: [order] }
              : { data: [] },
        }
      }
      return {}
    },
    __provider: provider,
  })

  const shipglobalLike = {
    ratesNeedOriginPincode: false,
    getRates: jest.fn(async (q: any) => {
      calls.push(q)
      return [{ courier_id: 1, courier_name: "SG Direct", amount: 3200 }]
    }),
    // Deliberately NO listPickupLocations — that is the shape under test.
  }

  let calls: any[] = []
  beforeEach(() => {
    calls = []
    shipglobalLike.getRates.mockClear()
  })

  it("🔴 quotes a destination-keyed carrier that lists no pickups", async () => {
    jest.resetModules()
    jest.doMock("../../../modules/shipping-providers/resolver", () => ({
      resolveShippingProvider: async () => shipglobalLike,
      isSupportedCarrier: () => true,
      shipmentRefFromFulfillment: () => undefined,
    }))
    const { getShiprocketRatesForOrder: fn } = require("../shiprocket-rates")

    const res = await fn(container(shipglobalLike) as any, {
      orderId: "order_1",
      carrier: "shipglobal",
      weightGrams: 3540,
    })

    expect(res.rates).toHaveLength(1)
    // The origin is passed through EMPTY, exactly as checkout has always done.
    expect(calls[0].origin_pincode).toBe("")
    expect(calls[0].destination_country).toBe("CH")
  })

  /**
   * 🔴 The guard must still bite for a lane-rating carrier. A carrier that needs
   * an origin and simply has not implemented the pickup list yet must fail
   * loudly, not quietly quote from nowhere — which is why the opt-out is
   * declared by the provider rather than inferred from the missing method.
   */
  it("🔴 still refuses a lane-rating carrier that cannot list pickups", async () => {
    jest.resetModules()
    const laneRating = { getRates: jest.fn() } // no flag, no listPickupLocations
    jest.doMock("../../../modules/shipping-providers/resolver", () => ({
      resolveShippingProvider: async () => laneRating,
      isSupportedCarrier: () => true,
      shipmentRefFromFulfillment: () => undefined,
    }))
    const { getShiprocketRatesForOrder: fn } = require("../shiprocket-rates")

    await expect(
      fn(container(laneRating) as any, {
        orderId: "order_1",
        carrier: "somelane",
        weightGrams: 1000,
      })
    ).rejects.toThrow(/origin pincode/i)
    expect(laneRating.getRates).not.toHaveBeenCalled()
  })
})
