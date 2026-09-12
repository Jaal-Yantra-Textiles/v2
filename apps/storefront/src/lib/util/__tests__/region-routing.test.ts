import { describe, expect, it } from "vitest"

import {
  REGION_MAP_UNCONFIGURED,
  isUnconfiguredRegionsError,
  pickCountryCode,
} from "../region-routing"

const mapOf = (...codes: string[]) =>
  new Map<string, unknown>(codes.map((c) => [c, { id: `reg_${c}` }]))

describe("pickCountryCode — populated map (behaviour must be unchanged)", () => {
  it("honours an explicit country in the URL", () => {
    expect(
      pickCountryCode({
        urlCountryCode: "gb",
        regionMap: mapOf("us", "gb"),
        defaultRegion: "us",
      })
    ).toEqual({ countryCode: "gb", degraded: false })
  })

  it("falls to the Vercel geo header when the URL has no country", () => {
    expect(
      pickCountryCode({
        vercelCountryCode: "gb",
        regionMap: mapOf("us", "gb"),
        defaultRegion: "us",
      }).countryCode
    ).toBe("gb")
  })

  it("prefers DEFAULT_REGION over an arbitrary map key", () => {
    // The ordering that matters: "us" is second in the map, so a first-key
    // read would answer "gb".
    expect(
      pickCountryCode({
        regionMap: mapOf("gb", "us"),
        defaultRegion: "us",
      }).countryCode
    ).toBe("us")
  })

  it("ignores a URL country the map does not contain", () => {
    // A path segment like /products must not be treated as a country.
    expect(
      pickCountryCode({
        urlCountryCode: "products",
        regionMap: mapOf("us"),
        defaultRegion: "us",
      }).countryCode
    ).toBe("us")
  })

  it("never reports degraded while the map is populated", () => {
    expect(
      pickCountryCode({ regionMap: mapOf("us"), defaultRegion: "us" }).degraded
    ).toBe(false)
  })
})

describe("pickCountryCode — EMPTY map (#1993, the cold-start case)", () => {
  it("returns DEFAULT_REGION instead of nothing", () => {
    // Returning undefined is what produced "No valid regions configured" —
    // a 500 on every route of a cold instance.
    expect(
      pickCountryCode({ regionMap: new Map(), defaultRegion: "us" })
    ).toEqual({ countryCode: "us", degraded: true })
  })

  it("keeps a buyer on the country they were already on", () => {
    // A buyer returning to /gb/order/confirmed during an outage should land
    // where they were, not be bounced to /us.
    expect(
      pickCountryCode({
        urlCountryCode: "gb",
        regionMap: new Map(),
        defaultRegion: "us",
      })
    ).toEqual({ countryCode: "gb", degraded: true })
  })

  it("does NOT mistake a path segment for a country code", () => {
    // 🔑 With no map there is nothing to validate against, so the only test
    // left is shape. Without it, /products/foo would be rewritten to
    // /products/products/foo and the buyer's URL becomes nonsense.
    expect(
      pickCountryCode({
        urlCountryCode: "products",
        regionMap: new Map(),
        defaultRegion: "us",
      }).countryCode
    ).toBe("us")
  })

  it("uses the Vercel geo header before DEFAULT_REGION", () => {
    expect(
      pickCountryCode({
        vercelCountryCode: "de",
        regionMap: new Map(),
        defaultRegion: "us",
      })
    ).toEqual({ countryCode: "de", degraded: true })
  })

  it("reports no country when there is no default either", () => {
    // The caller still needs to be able to refuse. Inventing a country here
    // would route every visitor of an unconfigured deploy to a region nobody
    // chose.
    expect(
      pickCountryCode({ regionMap: new Map(), defaultRegion: undefined })
    ).toEqual({ countryCode: undefined, degraded: true })
  })

  it("always marks the pick degraded, whichever branch answered", () => {
    const picks = [
      pickCountryCode({ urlCountryCode: "gb", regionMap: new Map(), defaultRegion: "us" }),
      pickCountryCode({ vercelCountryCode: "de", regionMap: new Map(), defaultRegion: "us" }),
      pickCountryCode({ regionMap: new Map(), defaultRegion: "us" }),
    ]
    expect(picks.map((p) => p.degraded)).toEqual([true, true, true])
  })
})

describe("isUnconfiguredRegionsError", () => {
  it("recognises the tagged error", () => {
    const e = new Error("No regions found.")
    e.name = REGION_MAP_UNCONFIGURED
    expect(isUnconfiguredRegionsError(e)).toBe(true)
  })

  it("does NOT treat an outage as a misconfiguration", () => {
    // The distinction the whole fix rests on: a dead backend must degrade,
    // a zero-region backend must stay loud.
    expect(isUnconfiguredRegionsError(new TypeError("fetch failed"))).toBe(false)
  })

  it("is not fooled by a matching MESSAGE", () => {
    // Checked on `name`, which we set, not on prose that gets reworded.
    expect(isUnconfiguredRegionsError(new Error(REGION_MAP_UNCONFIGURED))).toBe(false)
  })

  it("tolerates null and undefined", () => {
    expect(isUnconfiguredRegionsError(null)).toBe(false)
    expect(isUnconfiguredRegionsError(undefined)).toBe(false)
  })
})
