import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { FX_RATES_MODULE } from "../../../src/modules/fx_rates"
import type FxRatesService from "../../../src/modules/fx_rates/service"
import fanoutPricesWorkflow from "../../../src/workflows/fx/fanout-prices"

jest.setTimeout(60 * 1000)

// Workflow behavior tests for fanout-prices-from-source.
//
// The full happy-path fanout (variant → product → sales_channel →
// store → fan out) needs real partner provisioning to wire the
// link chain — covered by manual end-to-end testing once the partner
// UI piece is live and we can drive it via real partner data. This
// file covers the guards + edge cases that don't need the full chain:
// recursion guard via fx_price_meta link, orphan variant (no store
// resolvable), and source-not-found.

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

  describe("workflows/fx/fanout-prices-from-source", () => {
    let container: any
    let fxService: FxRatesService

    beforeEach(async () => {
      container = getContainer()
      fxService = container.resolve(FX_RATES_MODULE) as FxRatesService

      fxService.setProvider({
        fetchRates: async () =>
          fakeProviderResult({
            usd: 1,
            inr: 83.33,
            eur: 0.92,
            gbp: 0.79,
          }),
      })
      await fxService.refreshRatesFromProvider()
    })

    it("skips when source price has a linked fx_price_meta (recursion guard)", async () => {
      const pricingService = container.resolve(Modules.PRICING) as any
      const link = container.resolve(ContainerRegistrationKeys.LINK) as any

      const [priceSet] = await pricingService.createPriceSets([
        { prices: [{ amount: 1000, currency_code: "usd", rules: {} }] },
      ])
      const sourcePriceId = priceSet.prices[0].id

      const [meta] = await fxService.createFxPriceMetas([
        {
          base_currency: "inr",
          base_amount: 83330,
          fx_rate: 0.012,
          source_price_id: "price_source_synth",
        },
      ])
      await link.create([
        {
          [Modules.PRICING]: { price_id: sourcePriceId },
          [FX_RATES_MODULE]: { fx_price_meta_id: meta.id },
        },
      ])

      const { result } = await fanoutPricesWorkflow(container).run({
        input: { source_price_id: sourcePriceId },
      })

      expect(result.skipped_reason).toMatch(/auto-converted/)
      expect(result.created_count).toBe(0)
    })

    it("skips when no store is resolvable from the variant link", async () => {
      // Orphan price_set — created without linking to any variant.
      // The workflow's variant-link lookup returns nothing →
      // skipped_reason.
      const pricingService = container.resolve(Modules.PRICING) as any
      const [priceSet] = await pricingService.createPriceSets([
        {
          prices: [
            { amount: 500, currency_code: "inr", rules: {} },
          ],
        },
      ])

      const { result } = await fanoutPricesWorkflow(container).run({
        input: { source_price_id: priceSet.prices[0].id },
      })

      expect(result.skipped_reason).toMatch(/no store resolvable/)
      expect(result.created_count).toBe(0)
    })

    it("skips when source price doesn't exist", async () => {
      const { result } = await fanoutPricesWorkflow(container).run({
        input: { source_price_id: "price_does_not_exist" },
      })

      expect(result.skipped_reason).toMatch(/not found/)
      expect(result.created_count).toBe(0)
    })
  })
})
