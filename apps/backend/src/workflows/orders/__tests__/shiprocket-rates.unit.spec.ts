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
