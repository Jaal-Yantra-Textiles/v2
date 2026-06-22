import { chooseRegisteredPickup } from "../pickup-locations"
import type { PickupLocation } from "../provider-interface"

/**
 * #638 — when a fulfillment's stock location carries no Shiprocket nickname,
 * Generate-Label falls back to a registered pickup. `chooseRegisteredPickup`
 * picks which one: prefer a shippable pickup, else the first registered one,
 * else undefined (caller then throws a clean "configure a pickup" error).
 */
describe("chooseRegisteredPickup (#638)", () => {
  const p = (name: string, shippable?: boolean): PickupLocation => ({
    name,
    shippable,
  })

  it("returns undefined for no registered pickups", () => {
    expect(chooseRegisteredPickup([])).toBeUndefined()
    expect(chooseRegisteredPickup(undefined)).toBeUndefined()
    expect(chooseRegisteredPickup(null)).toBeUndefined()
  })

  it("prefers a shippable pickup over a non-shippable earlier one", () => {
    const chosen = chooseRegisteredPickup([
      p("warehouse-a", false),
      p("warehouse-b", true),
    ])
    expect(chosen?.name).toBe("warehouse-b")
  })

  it("returns the first shippable pickup when several are shippable", () => {
    const chosen = chooseRegisteredPickup([
      p("warehouse-a", false),
      p("warehouse-b", true),
      p("warehouse-c", true),
    ])
    expect(chosen?.name).toBe("warehouse-b")
  })

  it("falls back to the first registered pickup when none are shippable", () => {
    const chosen = chooseRegisteredPickup([
      p("warehouse-a", false),
      p("warehouse-b", false),
    ])
    expect(chosen?.name).toBe("warehouse-a")
  })

  it("treats an undefined shippable flag as not-preferred but still selectable", () => {
    const chosen = chooseRegisteredPickup([p("warehouse-a"), p("warehouse-b", true)])
    expect(chosen?.name).toBe("warehouse-b")

    const onlyUnknown = chooseRegisteredPickup([p("warehouse-a"), p("warehouse-b")])
    expect(onlyUnknown?.name).toBe("warehouse-a")
  })
})
