import { pickRatesPickup } from "../shiprocket-rates"
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
