import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  setupQuoteFixture,
  mintBody,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"

jest.setTimeout(240 * 1000)

/**
 * The maker section on the buyer's quote page, against a database (#1439 S9).
 *
 * ## Why a container run and not just the unit suites
 *
 * `buildProvenance` is pure and fully unit-tested, and `resolve-provenance` has
 * its own suite against a fake scope. Both were green while the feature did not
 * exist at all — nothing imported the shaper for months. Everything that can
 * still be wrong now lives in the WIRING, and none of it is visible to a fake:
 *
 * - the product-side graph alias is the linked MODEL name,
 *   `artisan_product_detail`. `artisan_detail.*` returns nothing, silently —
 *   that exact mistake cost #859 its maker story;
 * - the onboarding profile is reached through a module service, not the graph;
 * - `partners` must be filtered by id on a PUBLIC unauthenticated route
 *   (#1397);
 * - and the public route has to actually put the block in its response.
 *
 * ## The assertion that matters most
 *
 * Not that the rows render — that the COMMERCIAL terms do not. This payload is
 * served to anyone holding the link, with no login. `commission_bps`,
 * `price_range`, `payment_collection` and `selling_mode` all sit on the very
 * profile row this reads from, and the shaper's exclusion list is the only
 * thing keeping them off a buyer's screen. A test that only checks for
 * "Made by" would pass just as happily with the whole row published.
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
  describe("GET /store/b2b/quotes/:token — provenance (#1448)", () => {
    let seed: QuoteFixture
    let storeHeaders: Record<string, string>

    const MAKER_STORY = "Woven on pit looms in the Kashmir valley."

    beforeAll(async () => {
      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      seed = await setupQuoteFixture(api, getContainer)
      storeHeaders = { "x-publishable-api-key": seed.publishableKey }

      const container = getContainer()

      // The partner half. `is_verified` is written through the module because
      // no partner-facing route may set its own verification — that is the
      // point of the flag.
      const partnerModule: any = container.resolve("partner")
      await partnerModule.updatePartners({
        id: seed.partnerId,
        is_verified: true,
        country_code: "IN",
      })

      // The onboarding profile, through the route a partner actually uses —
      // carrying the commercial fields that must NOT come back out.
      await loud("onboarding", () =>
        api.put(
          "/partners/onboarding-profile",
          {
            what_they_sell: "home_textiles",
            person_type: "artisan",
            team_size: 12,
            does_weaving: true,
            price_range: "luxury",
            commission_bps: 1500,
            payment_collection: "through_us",
            selling_mode: "core_channel_listing",
          },
          { headers: seed.headers }
        )
      )

      // The product half, likewise through the partner's own route.
      await loud("artisan-detail", () =>
        api.post(
          `/partners/products/${seed.productId}/artisan-detail`,
          {
            maker_story: MAKER_STORY,
            lead_time_days: 21,
            min_order_quantity: 50,
            made_to_order: true,
          },
          { headers: seed.headers }
        )
      )
    })

    /** Mint a quote and read it back as the buyer would. */
    const mintAndView = async (overrides: Record<string, any> = {}) => {
      const { api } = getSharedTestEnv()
      const mint = await loud("mint", () =>
        api.post("/partners/quotes", mintBody(seed, overrides), {
          headers: seed.headers,
        })
      )
      const token = mint.data.token
      const view = await loud("view", () =>
        api.get(`/store/b2b/quotes/${token}`, { headers: storeHeaders })
      )
      return { quote: view.data.quote, minted: mint.data.quote }
    }

    it("renders the maker's facts and story on the buyer's page", async () => {
      const { quote } = await mintAndView({
        buyer_email: `buyer-prov-${seed.unique}@jaalyantra.test`,
        // ONE product, so every per-product fact is basket-wide and the full
        // row set is expected.
        lines: [{ variant_id: seed.variantA.id, quantity: 25 }],
      })

      const provenance = quote.provenance
      expect(provenance).toBeTruthy()
      expect(provenance.maker_name).toBe(`QuoteTest ${seed.unique}`)
      expect(provenance.maker_story).toBe(MAKER_STORY)

      const byKey = Object.fromEntries(
        (provenance.rows ?? []).map((r: any) => [r.key, r])
      )
      // Partner-level, from two different records — proof both halves of the
      // fetch landed, not just the one that is easy to reach.
      expect(byKey.maker?.value).toBe(`QuoteTest ${seed.unique}`)
      expect(byKey.country?.value).toBe("India")
      expect(byKey.verified).toBeTruthy()
      expect(byKey.maker_type?.value).toBe("Artisan")
      expect(byKey.weaving).toBeTruthy()
      // Product-level, through the link alias that silently returns nothing
      // when it is spelled `artisan_detail`.
      expect(byKey.made_to_order).toBeTruthy()
      expect(byKey.lead_time?.value).toBe("21 days")
      expect(byKey.min_order_quantity?.value).toBe("50 units")

      // Every row carries where it came from — an unattributed fact is a claim.
      for (const row of provenance.rows) {
        expect(["partner", "partner-onboarding-profile", "artisan-product-detail"])
          .toContain(row.source)
        // And no row is ever a blank or an em-dash: absent means ABSENT.
        expect(String(row.value).trim().length).toBeGreaterThan(0)
        expect(row.value).not.toBe("—")
      }
    })

    it("🔴 publishes NO commercial term to the buyer", async () => {
      const { quote } = await mintAndView({
        buyer_email: `buyer-leak-${seed.unique}@jaalyantra.test`,
        lines: [{ variant_id: seed.variantA.id, quantity: 25 }],
      })

      // 🔑 Assert there is something to leak FROM first. This test passed
      // vacuously on the very first run — `provenance` was null, and
      // JSON.stringify(null) contains none of the secrets. A leak test that
      // is green when the feature is absent proves nothing at all.
      expect(quote.provenance).toBeTruthy()
      expect(quote.provenance.rows.length).toBeGreaterThan(0)

      // The WHOLE provenance block, not just the rows: a leak through
      // maker_story or a stray passthrough field counts the same.
      const published = JSON.stringify(quote.provenance).toLowerCase()
      for (const secret of [
        "commission",
        "1500",
        "price_range",
        "luxury",
        "payment_collection",
        "through_us",
        "selling_mode",
        "core_channel_listing",
        "supplies_to_platform",
        "tax_id",
      ]) {
        expect(published).not.toContain(secret)
      }
    })

    it("keeps the partner facts but drops per-product claims on a MIXED basket", async () => {
      // A second product with NO artisan detail row. Its lead time is not
      // "the same" — it is unknown, and stating the first product's over the
      // whole quote would be a claim about an item it was never made about.
      const { api, getContainer } = getSharedTestEnv()
      const second = await loud("second-product", () =>
        api.post(
          "/partners/products",
          {
            store_id: seed.storeId,
            product: {
              title: `Undocumented Stole ${seed.unique}`,
              status: "published",
              options: [{ title: "Weave", values: ["Plain"] }],
              variants: [
                {
                  title: "Plain",
                  sku: `UP-UND-${seed.unique}`,
                  options: { Weave: "Plain" },
                  manage_inventory: false,
                  weight: 400,
                  length: 40,
                  width: 30,
                  height: 5,
                  prices: [{ amount: 31000, currency_code: seed.currencyCode }],
                },
              ],
            },
          },
          { headers: seed.headers }
        )
      )
      const secondVariantId = second.data.product.variants[0].id

      const link = getContainer().resolve(ContainerRegistrationKeys.LINK) as any
      await link
        .create({
          product: { product_id: second.data.product.id },
          sales_channel: { sales_channel_id: seed.salesChannelId },
        })
        .catch(() => {})

      const { quote } = await mintAndView({
        buyer_email: `buyer-mixed-${seed.unique}@jaalyantra.test`,
        lines: [
          { variant_id: seed.variantA.id, quantity: 25 },
          { variant_id: secondVariantId, quantity: 10 },
        ],
      })

      const keys = (quote.provenance?.rows ?? []).map((r: any) => r.key)
      // Who they are still holds for the whole basket…
      expect(keys).toContain("maker")
      expect(keys).toContain("weaving")
      // …but nothing that was only ever true of one product survives, and the
      // story is silent rather than borrowed from line one.
      expect(keys).not.toContain("lead_time")
      expect(keys).not.toContain("min_order_quantity")
      expect(keys).not.toContain("made_to_order")
      expect(quote.provenance.maker_story).toBeNull()
    })
  })
})
