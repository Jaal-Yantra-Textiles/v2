import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { FX_RATES_MODULE } from "../../../src/modules/fx_rates"
import type FxRatesService from "../../../src/modules/fx_rates/service"
import type { FxProvider, FxProviderResult } from "../../../src/modules/fx_rates/providers/types"

jest.setTimeout(60 * 1000)

// Verifies the fx_rates module's core behaviors. Doesn't hit the real
// open.er-api.com — uses a fake FxProvider directly via the service's
// applyProviderResult path.
//
// Covers:
//   1. setRates / getRate roundtrip
//   2. Cross-rate computation via USD intermediate
//   3. Same-currency short-circuit (returns 1)
//   4. Inverse lookup when direct row is missing
//   5. Idempotent upsert (re-apply doesn't duplicate)
//   6. getLastFetchedAt reports the most recent fetched_at

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("modules/fx_rates", () => {
    let svc: FxRatesService

    beforeEach(async () => {
      svc = getContainer().resolve(FX_RATES_MODULE) as FxRatesService

      // Each test gets a fresh world. Wipe any rates created by earlier
      // tests in this file via the service's listing + delete.
      const all = await svc.listFxRates({})
      for (const r of all) {
        await svc.deleteFxRates(r.id)
      }
    })

    const fakeResult = (overrides: Partial<FxProviderResult> = {}): FxProviderResult => ({
      base_currency: "usd",
      fetched_at: new Date("2026-05-25T00:00:00Z"),
      source: "test-fake",
      rates: {
        usd: 1,
        inr: 83.25,
        eur: 0.92,
        gbp: 0.79,
      },
      ...overrides,
    })

    it("setRates + getRate roundtrip — direct pair returns stored value", async () => {
      await svc.applyProviderResult(fakeResult())

      expect(await svc.getRate("usd", "inr")).toBeCloseTo(83.25, 4)
      expect(await svc.getRate("usd", "eur")).toBeCloseTo(0.92, 4)
    })

    it("returns 1 when from === to", async () => {
      await svc.applyProviderResult(fakeResult())

      expect(await svc.getRate("inr", "inr")).toBe(1)
      expect(await svc.getRate("USD", "usd")).toBe(1) // case-insensitive
    })

    it("computes cross-rate via USD intermediate when direct pair is missing", async () => {
      await svc.applyProviderResult(fakeResult())

      // INR→EUR = (USD→EUR) / (USD→INR) = 0.92 / 83.25 ≈ 0.01105
      const inrToEur = await svc.getRate("inr", "eur")
      expect(inrToEur).toBeCloseTo(0.92 / 83.25, 6)

      // GBP→INR = (USD→INR) / (USD→GBP) = 83.25 / 0.79 ≈ 105.38
      const gbpToInr = await svc.getRate("gbp", "inr")
      expect(gbpToInr).toBeCloseTo(83.25 / 0.79, 4)
    })

    it("uses inverse when only the opposite direction is cached", async () => {
      // Only seed USD as base. INR→USD = 1/(USD→INR) = 1/83.25.
      await svc.applyProviderResult(fakeResult())

      const inrToUsd = await svc.getRate("inr", "usd")
      expect(inrToUsd).toBeCloseTo(1 / 83.25, 6)
    })

    it("upsert is idempotent — re-applying the same result doesn't create duplicates", async () => {
      await svc.applyProviderResult(fakeResult())
      const first = await svc.listFxRates({})

      await svc.applyProviderResult(fakeResult({ fetched_at: new Date("2026-05-26T00:00:00Z") }))
      const second = await svc.listFxRates({})

      expect(second.length).toBe(first.length)
      const usdInr = second.find(
        (r: any) => r.base_currency === "usd" && r.quote_currency === "inr"
      )
      expect(new Date((usdInr as any).fetched_at).toISOString()).toBe(
        "2026-05-26T00:00:00.000Z"
      )
    })

    it("getLastFetchedAt returns the latest fetched_at across the cache", async () => {
      const noneYet = await svc.getLastFetchedAt()
      expect(noneYet).toBeNull()

      await svc.applyProviderResult(fakeResult())
      const after = await svc.getLastFetchedAt()
      expect(after?.toISOString()).toBe("2026-05-25T00:00:00.000Z")

      // Apply a newer result on top — last_fetched moves forward.
      await svc.applyProviderResult(
        fakeResult({ fetched_at: new Date("2026-05-26T12:00:00Z") })
      )
      const later = await svc.getLastFetchedAt()
      expect(later?.toISOString()).toBe("2026-05-26T12:00:00.000Z")
    })

    it("refreshRatesFromProvider uses the injected provider", async () => {
      // Replace the service's provider with a fake one. This exercises
      // the integration between provider + applyProviderResult.
      const fake: FxProvider = {
        fetchRates: async () =>
          fakeResult({ rates: { usd: 1, jpy: 156.4 } }),
      }
      ;(svc as any).provider = fake

      const summary = await svc.refreshRatesFromProvider()

      expect(summary.base_currency).toBe("usd")
      expect(summary.source).toBe("test-fake")
      expect(summary.upserted).toBe(2)
      expect(await svc.getRate("usd", "jpy")).toBeCloseTo(156.4, 3)
    })

    it("getRate throws clearly when no path exists", async () => {
      // Empty cache.
      await expect(svc.getRate("usd", "inr")).rejects.toThrow(
        /no rates cached/i
      )

      // Cache that has no path between the requested codes.
      await svc.applyProviderResult({
        base_currency: "usd",
        fetched_at: new Date(),
        source: "isolated-test",
        rates: { usd: 1, jpy: 156.4 },
      })
      await expect(svc.getRate("inr", "eur")).rejects.toThrow(
        /no path from inr to eur/i
      )
    })
  })
})
