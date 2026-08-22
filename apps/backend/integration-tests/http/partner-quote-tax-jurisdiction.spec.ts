import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { Modules } from "@medusajs/framework/utils"
import {
  createShippingOptionsWorkflow,
  createTaxRegionsWorkflow,
} from "@medusajs/medusa/core-flows"
import {
  setupQuoteFixture,
  mintBody,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"

jest.setTimeout(240 * 1000)

/**
 * Whose tax is it — origin, not destination (#1439 S8 / #1447).
 *
 * The first cut of `resolveQuoteTax` asked the Tax module using the DESTINATION
 * country alone, which quietly assumes the seller is registered wherever the
 * buyer happens to be. Goods on this platform always dispatch from India, so a
 * German buyer was shown 19% German VAT on an Indian export — a fifth added to
 * the headline number of every EU quote. It over-quoted rather than
 * under-quoted, so it lost deals instead of money, but it was never right.
 *
 * ## What only a container run can check
 *
 * That the origin is actually READ — off `store.default_location_id`, through
 * `query.graph`, into the classifier. The pure classifier is unit-tested and
 * would pass whether or not anything ever called it; `buildProvenance` sat
 * written, tested and imported by nothing for months on exactly that gap
 * (#1448). Here a domestic quote can only reach `calculated` if the origin
 * resolved to IN and matched, so the assertion is a wiring proof, not a
 * restatement of the unit test.
 *
 * The second thing only a real run shows: tax is computed INSIDE the
 * freight-success branch, so an export needs a real lane to the destination
 * before it has any tax status at all.
 */

const loud = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e: any) {
    console.log(`[${label}] ${e.response?.status}`, JSON.stringify(e.response?.data))
    throw e
  }
}

setupSharedTestSuite(() => {
  describe("quote tax jurisdiction (#1447)", () => {
    let seed: QuoteFixture

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      const container = getContainer()
      await createAdminUser(container)
      seed = await setupQuoteFixture(api, getContainer)

      // ---- An Indian tax region, or every quote is `unknown` --------------
      // The harness truncates, so the canonical seed's rows are not here. 18%
      // is India's standard GST rate, matching seed-canonical-tax-regions.ts.
      const tax: any = container.resolve(Modules.TAX)
      const existing = await tax.listTaxRegions({ country_code: "in" })
      if (!existing.length) {
        // ⚠️ Through the workflow, and WITH a `provider_id`. A region created
        // straight off the service with no provider throws
        // `AwilixResolutionError: Could not resolve 'null'` deep inside
        // `TaxProviderService.retrieveProvider` the first time anything asks it
        // for tax lines — and `resolveQuoteTax` catches that into
        // `status: "unknown"`, so the quote reads as merely untaxed rather than
        // misconfigured. `tp_system` ships with Medusa and is what
        // seed-canonical-tax-regions.ts uses.
        await createTaxRegionsWorkflow(container).run({
          input: [
            {
              country_code: "in",
              provider_id: "tp_system",
              default_tax_rate: {
                name: "India GST (standard)",
                code: "IN-GST",
                rate: 18,
              },
            } as any,
          ],
        })
      }

      // ---- A real lane to Germany ----------------------------------------
      // Without one the mint's S6 preflight refuses the quote and tax is never
      // reached: it is computed after freight succeeds, not alongside it.
      const fulfillment: any = container.resolve(Modules.FULFILLMENT)
      const link: any = container.resolve("link")
      const profiles = await fulfillment.listShippingProfiles({})
      const set = await fulfillment.createFulfillmentSets({
        name: `Quote Export Shipping ${seed.unique}`,
        type: "shipping",
      })
      const zone = await fulfillment.createServiceZones({
        name: `Germany ${seed.unique}`,
        fulfillment_set_id: set.id,
        geo_zones: [{ type: "country", country_code: "de" }],
      })
      await link
        .create({
          [Modules.STOCK_LOCATION]: { stock_location_id: seed.locationId },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        })
        .catch(() => {})
      await createShippingOptionsWorkflow(container).run({
        input: [
          {
            name: `Quote Export Freight ${seed.unique}`,
            service_zone_id: zone.id,
            shipping_profile_id: profiles[0].id,
            provider_id: "manual_manual",
            type: { label: "Flat", description: "Flat freight", code: "flat" },
            price_type: "flat",
            prices: [{ amount: 2500, currency_code: seed.currencyCode }],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
            ],
          } as any,
        ],
      })
    })

    /** Mint, then read the buyer view the storefront reads. */
    const mintAndView = async (overrides: Record<string, any>) => {
      const { api } = getSharedTestEnv()
      const mint = await loud("mint", () =>
        api.post("/partners/quotes", mintBody(seed, overrides), {
          headers: seed.headers,
        })
      )
      const token = mint.data.token
      expect(token).toBeTruthy()
      // The buyer route is a /store/* route, so it needs the storefront's
      // publishable key even though the quote token is the actual credential.
      const view = await loud("view", () =>
        api.get(`/store/b2b/quotes/${token}`, {
          headers: { "x-publishable-api-key": seed.publishableKey },
        })
      )
      return view.data.quote
    }

    it("computes GST on a domestic quote — which proves the origin was read", async () => {
      const quote = await mintAndView({
        buyer_email: `buyer-domestic-${seed.unique}@jaalyantra.test`,
        destination_country_code: "in",
        destination_postal_code: "400001",
      })

      // 🔑 The wiring proof. If `resolveStoreOriginCountry` had returned null,
      // this would be `unknown` — the classifier refuses to assume domestic.
      // Reaching `calculated` means the store's stock location was read, came
      // back IN, and matched the destination.
      expect(quote.tax.status).toBe("calculated")
      expect(quote.tax.total).toBeGreaterThan(0)
      expect(quote.tax.reason).toBeNull()
      expect(quote.tax.rates.length).toBeGreaterThan(0)
      expect(quote.tax.rates.some((r: any) => r.on === "goods")).toBe(true)

      const money = quote.live ?? quote.quoted
      expect(money.tax_total).toBeGreaterThan(0)
      // Exclusive prices: gross is strictly above goods+freight by the tax.
      expect(money.gross_total).toBeCloseTo(
        money.landed_total + money.tax_total,
        2
      )
    })

    it("zero-rates an export to Germany instead of charging German VAT", async () => {
      const quote = await mintAndView({
        buyer_email: `buyer-export-${seed.unique}@jaalyantra.test`,
        destination_country_code: "de",
        destination_postal_code: "10115",
        destination_city: "Berlin",
      })

      expect(quote.tax.status).toBe("zero_rated_export")
      // A REAL zero, not a missing number — the distinction the status carries.
      expect(quote.tax.total).toBe(0)
      expect(quote.tax.rates).toEqual([])

      // 🔴 The regression this suite exists for. A destination-keyed lookup
      // would have found no German tax region in this DB and said `unknown`;
      // on prod, where the canonical seed HAS a `de` region at 19%, it would
      // have said `calculated` and added a fifth to the total. Neither is right.
      expect(quote.tax.status).not.toBe("calculated")
      expect(quote.tax.rates.some((r: any) => r.rate === 19)).toBe(false)

      const money = quote.live ?? quote.quoted
      expect(money.tax_total).toBe(0)
      // Nothing added: a zero-rated export's gross IS goods + freight.
      expect(money.gross_total).toBeCloseTo(money.landed_total, 2)
    })

    it("tells the buyer duty is theirs — the half a bare zero would hide", async () => {
      const quote = await mintAndView({
        buyer_email: `buyer-duty-${seed.unique}@jaalyantra.test`,
        destination_country_code: "de",
        destination_postal_code: "10115",
        destination_city: "Berlin",
      })

      // The zero is honest only because this sentence exists. Without it the
      // page shows a complete-looking total and the buyer meets a customs bill
      // they never budgeted for — #1430's shape.
      const reason: string = quote.tax.reason
      expect(reason).toBeTruthy()
      expect(reason).toMatch(/export from IN to DE/)
      expect(reason).toMatch(/zero-rated/)
      expect(reason).toMatch(/duty/i)
      expect(reason).toMatch(/payable by you/i)
      expect(reason).toMatch(/NOT included/)
    })

    it("keeps the freight leg out of the export's tax, not merely out of its rate", async () => {
      const quote = await mintAndView({
        buyer_email: `buyer-freight-${seed.unique}@jaalyantra.test`,
        destination_country_code: "de",
        destination_postal_code: "10115",
        destination_city: "Berlin",
      })

      const money = quote.live ?? quote.quoted
      // Freight is really present — otherwise "no freight tax" would be
      // vacuously true and this test would pass on a broken lane.
      expect(money.freight).toBeGreaterThan(0)
      expect(quote.tax.total).toBe(0)
    })
  })
})
