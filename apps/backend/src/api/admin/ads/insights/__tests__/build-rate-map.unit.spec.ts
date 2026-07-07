import { buildRateMap } from "../route"

/**
 * On-read base-currency normalization for Google/Meta ads insights. buildRateMap
 * resolves one FX rate per distinct native currency to the base/display currency.
 */
describe("ads insights buildRateMap", () => {
  it("returns rate 1 for the same currency without calling FX", async () => {
    const fx = { getRate: jest.fn() }
    const map = await buildRateMap(fx, ["eur", "EUR"], "eur")
    expect(map.get("eur")).toBe(1)
    expect(fx.getRate).not.toHaveBeenCalled()
  })

  it("looks up cross-currency rates once per distinct currency", async () => {
    const fx = { getRate: jest.fn().mockResolvedValue(89.6) }
    const map = await buildRateMap(fx, ["eur", "eur", "usd"], "inr")
    // "eur" appears twice but is resolved once
    expect(fx.getRate).toHaveBeenCalledTimes(2)
    expect(fx.getRate).toHaveBeenCalledWith("eur", "inr")
    expect(map.get("eur")).toBe(89.6)
    expect(map.get("usd")).toBe(89.6)
  })

  it("maps missing / empty currencies to null", async () => {
    const fx = { getRate: jest.fn() }
    const map = await buildRateMap(fx, [null, undefined, ""], "eur")
    expect(map.get("")).toBeNull()
  })

  it("falls back to null when the FX module is absent", async () => {
    const map = await buildRateMap(null, ["usd"], "eur")
    expect(map.get("usd")).toBeNull()
  })

  it("falls back to null when a rate lookup throws (no cached path)", async () => {
    const fx = { getRate: jest.fn().mockRejectedValue(new Error("NOT_FOUND")) }
    const map = await buildRateMap(fx, ["gbp"], "eur")
    expect(map.get("gbp")).toBeNull()
  })
})
