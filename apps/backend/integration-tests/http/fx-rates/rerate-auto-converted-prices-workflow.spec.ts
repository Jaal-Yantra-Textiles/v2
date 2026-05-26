import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { FX_RATES_MODULE } from "../../../src/modules/fx_rates"
import type FxRatesService from "../../../src/modules/fx_rates/service"
import rerateAutoConvertedPricesWorkflow from "../../../src/workflows/fx/rerate-auto-converted-prices"

jest.setTimeout(60 * 1000)

// Behavior tests for rerate-auto-converted-prices. We construct a
// price + fx_price_meta + link manually, then run the workflow with
// a SECOND set of (different) FX rates and assert the price amount
// + cached fx_rate get rewritten.

function fakeProviderResult(rates: Record<string, number>) {
  return {
    base_currency: "usd",
    fetched_at: new Date("2026-05-26T00:00:00Z"),
    source: "test-fake",
    rates,
  }
}

setupSharedTestSuite(() => {
  const { getContainer } = getSharedTestEnv()

  describe("workflows/fx/rerate-auto-converted-prices", () => {
    let container: any
    let fxService: FxRatesService

    beforeEach(async () => {
      container = getContainer()
      fxService = container.resolve(FX_RATES_MODULE) as FxRatesService

      // Seed an INITIAL rate cache so the fx_price_meta we set up
      // looks consistent with what fanout would have done at create time.
      fxService.setProvider({
        fetchRates: async () =>
          fakeProviderResult({
            usd: 1,
            inr: 80, // 1 USD = 80 INR (so 1 INR = 0.0125 USD)
            eur: 0.90,
          }),
      })
      await fxService.refreshRatesFromProvider()
    })

    it("rewrites price.amount + fx_price_meta.fx_rate using the current cache", async () => {
      const pricingService = container.resolve(Modules.PRICING) as any
      const link = container.resolve(ContainerRegistrationKeys.LINK) as any

      // Create a price_set with one USD price (mimics what fanout would
      // have created from a partner's INR=1000 base price).
      const [priceSet] = await pricingService.createPriceSets([
        { prices: [{ amount: 12.5, currency_code: "usd", rules: {} }] },
      ])
      const priceId = priceSet.prices[0].id

      // Attach an fx_price_meta marker with the SAME values fanout
      // would have stamped originally (rate=0.0125, base=inr 1000).
      const [meta] = await fxService.createFxPriceMetas([
        {
          base_currency: "inr",
          base_amount: 1000,
          fx_rate: 0.0125,
          source_price_id: "price_source_synth",
        },
      ])
      await link.create([
        {
          [Modules.PRICING]: { price_id: priceId },
          [FX_RATES_MODULE]: { fx_price_meta_id: meta.id },
        },
      ])

      // Now bump the FX cache to a DIFFERENT rate — INR weakens
      // (1 USD now = 90 INR, so 1 INR = ~0.0111 USD). After re-rate,
      // 1000 INR should be ~11.11 USD.
      fxService.setProvider({
        fetchRates: async () =>
          fakeProviderResult({
            usd: 1,
            inr: 90,
            eur: 0.92,
          }),
      })
      await fxService.refreshRatesFromProvider()

      const { result } = await rerateAutoConvertedPricesWorkflow(container).run({
        input: {},
      })

      expect(result.scanned).toBe(1)
      expect(result.updated).toBe(1)
      expect(result.skipped).toBe(0)
      expect(result.errors).toHaveLength(0)

      // Verify the price's amount actually changed.
      const updatedSet = await pricingService.retrievePriceSet(priceSet.id, {
        relations: ["prices"],
      })
      const updatedPrice = updatedSet.prices.find((p: any) => p.id === priceId)
      // 1000 INR → USD at 1/90 ≈ 11.11
      expect(Number(updatedPrice.amount)).toBeCloseTo(11.11, 1)

      // Verify the meta's cached fx_rate is also fresh.
      const [updatedMeta] = await fxService.listFxPriceMetas({ id: meta.id })
      const newRate = Number(updatedMeta.fx_rate)
      // 1 INR = 1/90 USD ≈ 0.0111
      expect(newRate).toBeCloseTo(0.0111, 3)
    })

    it("returns zeros when there are no fx_price_meta rows", async () => {
      const { result } = await rerateAutoConvertedPricesWorkflow(container).run({
        input: {},
      })

      expect(result.scanned).toBe(0)
      expect(result.updated).toBe(0)
      expect(result.skipped).toBe(0)
      expect(result.errors).toHaveLength(0)
    })
  })
})
