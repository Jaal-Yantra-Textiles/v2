import { createAdminUser } from "../helpers/create-admin-user"
import {
  mintBody,
  setupQuoteFixture,
  type QuoteFixture,
} from "../helpers/setup-quote-fixture"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(240 * 1000)

/**
 * Exporting from an HQ pin when the partner's cannot be rated (#1498), end to
 * end through a real mint.
 *
 * ## Why this exists as an integration test
 *
 * The unit tests cover the rule. They cannot cover the WIRING, and on this
 * feature the wiring is where it would break: the origins are read from
 * `location_ownership`, the rate goes out through the resolver's provider, the
 * result is filtered by the currency guard, ranked by `pickFreightOption` and
 * frozen onto the quote row. Every one of those is a place a correct rule
 * produces nothing.
 *
 * The fixture's own warehouse is Srinagar 190001, which the carrier genuinely
 * refuses for export — so the relay is exercised by the ordinary fixture rather
 * than by a contrivance.
 *
 * ## The numbers
 *
 * From the canned transport, which mirrors the live probe of 24 Aug 2026:
 *
 *   190001 Srinagar    → intl : "No serviceable couriers available"
 *   110096 JYT HQ      → intl : 1276 (and 2916)
 *   176215 Dharamshala → intl : 2916
 *   domestic first leg        :   78 (cheapest of 78 / 121)
 *
 * So the landed answer is 1276 + 78 = 1354 via Delhi, against 2916 + 78 = 2994
 * via Dharamshala. 🔑 The first leg is the same on both here, so this suite
 * asserts trap 1 (the hubs are not interchangeable) and leaves trap 2's
 * RANKING effect to the unit tests, where both legs can differ.
 */
setupSharedTestSuite(() => {
  describe("POST /partners/quotes — export relay from an owned hub (#1498)", () => {
    let seed: QuoteFixture
    let prevStub: string | undefined
    let prevEmail: string | undefined
    let prevPassword: string | undefined
    const hubs: string[] = []

    const container = () => getSharedTestEnv().getContainer()

    /** Our own warehouse, recorded as such — the only thing that makes it an origin. */
    const createOwnedHub = async (name: string, postal: string) => {
      const { api } = getSharedTestEnv()
      const headers = seed.headers
      const res = await api.post(
        "/admin/stock-locations",
        {
          name,
          address: {
            address_1: `${name} depot`,
            city: name,
            country_code: "in",
            postal_code: postal,
          },
        },
        adminConfig
      )
      const id = res.data.stock_location.id
      const ownership: any = container().resolve("location_ownership")
      await ownership.createLocationOwnerships({
        stock_location_id: id,
        is_core: true,
        note: `test hub ${postal}`,
      })
      hubs.push(id)
      void headers
      return id
    }


    /**
     * A DE lane on the partner's own location, mirroring prod.
     *
     * 🔴 Without it the mint never reaches the relay at all: readiness refuses
     * with "No freight option could be quoted to DE from this store's
     * location" (#1497), because the fixture ships with an India-only zone.
     * That refusal is CORRECT — a store with no configured lane to a country
     * genuinely cannot sell into it — but it means the relay can only ever help
     * a store that already has the lane. Worth knowing: rating a route is not
     * the same permission as being allowed to ship it.
     *
     * Priced deliberately ABOVE the relay's landed 1354, so a passing test
     * cannot be the flat row winning by being cheapest.
     */
    const FLAT_INTL = 5000

    const createInternationalLane = async () => {
      const { Modules } = await import("@medusajs/framework/utils")
      const { createShippingOptionsWorkflow } = await import(
        "@medusajs/medusa/core-flows"
      )
      const fulfillment: any = container().resolve(Modules.FULFILLMENT)
      const link: any = container().resolve("link")

      const profiles = await fulfillment.listShippingProfiles({})
      const set = await fulfillment.createFulfillmentSets({
        name: `Intl Shipping ${seed.unique}`,
        type: "shipping",
      })
      const zone = await fulfillment.createServiceZones({
        name: `International ${seed.unique}`,
        fulfillment_set_id: set.id,
        geo_zones: [{ type: "country", country_code: "de" }],
      })
      await link
        .create({
          [Modules.STOCK_LOCATION]: { stock_location_id: seed.locationId },
          [Modules.FULFILLMENT]: { fulfillment_set_id: set.id },
        })
        .catch(() => {})

      await createShippingOptionsWorkflow(container()).run({
        input: [
          {
            name: `Intl Flat ${seed.unique}`,
            service_zone_id: zone.id,
            shipping_profile_id: profiles[0].id,
            provider_id: "manual_manual",
            type: { label: "Flat", description: "Intl flat", code: "flat" },
            price_type: "flat",
            prices: [
              { amount: FLAT_INTL, currency_code: seed.currencyCode },
            ],
            rules: [
              { attribute: "enabled_in_store", value: "true", operator: "eq" },
              { attribute: "is_return", value: "false", operator: "eq" },
            ],
          } as any,
        ],
      })
    }
    let adminConfig: any

    beforeAll(async () => {
      prevStub = process.env.SHIPROCKET_STUB
      prevEmail = process.env.SHIPROCKET_EMAIL
      prevPassword = process.env.SHIPROCKET_PASSWORD
      process.env.SHIPROCKET_EMAIL = "test@shiprocket.example"
      process.env.SHIPROCKET_PASSWORD = "secret"
      process.env.SHIPROCKET_STUB = "1"

      const { api, getContainer } = getSharedTestEnv()
      await createAdminUser(getContainer())
      const { getAuthHeaders } = await import("../helpers/create-admin-user")
      adminConfig = await getAuthHeaders(api)

      seed = await setupQuoteFixture(api, () => container())

      await createOwnedHub("JYT HQ Delhi", "110096")
      await createOwnedHub("Dharamshala", "176215")

      await createInternationalLane()
    })

    afterAll(async () => {
      // 🔑 Owned hubs are GLOBAL — a stray core row would silently become an
      // export origin for every other spec sharing this database.
      const ownership: any = container().resolve("location_ownership")
      for (const id of hubs) {
        const rows = await ownership
          .listLocationOwnerships({ stock_location_id: id })
          .catch(() => [])
        for (const r of rows ?? []) {
          await ownership.deleteLocationOwnerships([r.id]).catch(() => {})
        }
      }
      if (prevStub === undefined) delete process.env.SHIPROCKET_STUB
      else process.env.SHIPROCKET_STUB = prevStub
      if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL
      else process.env.SHIPROCKET_EMAIL = prevEmail
      if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD
      else process.env.SHIPROCKET_PASSWORD = prevPassword
    })

    it("resolves the owned hubs into export origins", async () => {
      // The wiring, asserted on its own: ownership rows -> stock locations ->
      // origins. Without this a failure further down cannot be told apart from
      // "the carrier said no", and the lookup swallows its own errors.
      const { resolveCoreExportOrigins } = await import(
        "../../src/modules/shipping-providers/export-origins"
      )
      const origins = await resolveCoreExportOrigins(container())
      expect(origins.map((o: any) => o.pincode).sort()).toEqual([
        "110096",
        "176215",
      ])
    })

    it("🔴 builds the landed route: export leg + first leg, cheapest hub first", async () => {
      // The estimate on its own, before the quote machinery. Both traps are
      // visible here at once:
      //   trap 1 — 110096 exports at 1276, 176215 at 2916 for the SAME parcel
      //   trap 2 — the 78 first leg is part of the movement, not a rounding
      const { buildShippingEstimate } = await import(
        "../../src/lib/shipping-estimate"
      )
      const est = await buildShippingEstimate(container(), {
        lines: [{ variant_id: seed.variantA.id, quantity: 5 }],
        destination_postal_code: "10115",
        country_code: "de",
        currency_code: seed.currencyCode,
        carrier: "shiprocket",
        store: { id: seed.storeId, default_location_id: seed.locationId },
      })

      expect(est.calculated_error).toBeNull()
      // The origin REPORTED is still the partner's — the relay does not
      // rewrite where the goods are, only where they are rated from.
      expect(est.origin_postal_code).toBe("190001")

      const best = est.calculated[0]
      expect(best.amount).toBe(1354)
      expect(best.route).toMatchObject({
        via_hq: true,
        origin_pincode: "110096",
        origin_label: "JYT HQ Delhi",
        export_leg_amount: 1276,
        domestic_leg_amount: 78,
        domestic_leg_unrated: false,
      })

      // Every hub is offered, so the page can show the alternatives.
      expect(
        est.calculated.map((c: any) => c.route.origin_pincode)
      ).toEqual(expect.arrayContaining(["110096", "176215"]))
    })

    it("🔴 quotes an export the partner's own pin cannot carry", async () => {
      // The control for everything below: without the relay this lane has NO
      // carrier answer at all and falls to a flat rate that is one number
      // whatever the parcel weighs.
      const { api } = getSharedTestEnv()
      const res = await api
        .post(
          "/partners/quotes",
          mintBody(seed, {
            buyer_email: `relay-${seed.unique}@jaalyantra.test`,
            destination_country_code: "de",
            destination_postal_code: "10115",
            carrier: "shiprocket",
          }),
          { headers: seed.headers }
        )
        .catch((e: any) => {
          throw new Error(JSON.stringify(e.response?.data))
        })

      expect(res.status).toBe(201)
      // 🔑 NOT just "> 0" — the flat 5000 row satisfies that, and would have
      // satisfied it before the relay existed. The point is that a CARRIER
      // priced this lane.
      expect(Number(res.data.quote.quoted_freight)).toBeLessThan(FLAT_INTL)
    })

    it("🔴 takes the CHEAPER hub, and charges the first leg too", async () => {
      // Trap 1: the hubs are not interchangeable — 1276 against 2916 for the
      // same parcel. Trap 2: the export leg is not the price; the domestic leg
      // to the hub is part of the movement and 78 of it is ours to absorb if
      // it is not counted.
      const { api } = getSharedTestEnv()
      const res = await api.post(
        "/partners/quotes",
        mintBody(seed, {
          buyer_email: `relay-cheapest-${seed.unique}@jaalyantra.test`,
          destination_country_code: "de",
          destination_postal_code: "10115",
          carrier: "shiprocket",
        }),
        { headers: seed.headers }
      )

      // 1276 (Delhi export) + 78 (cheapest first leg) = 1354.
      // NOT 1276 — that would be the export quoted as if the goods teleported.
      // NOT 2994 — that would be the expensive hub winning.
      expect(Number(res.data.quote.quoted_freight)).toBeCloseTo(1354, 2)
    })


    it("🔴 converts the carrier's INR rate into a EUR quote (#1498 tail)", async () => {
      // The relay is worth nothing on a EUR quote unless the number can cross
      // currencies: every carrier rate on an export lane is in INR, so the
      // #1424 currency guard used to empty the calculated list and hand the
      // lane to whatever flat row existed — at any weight.
      //
      // 🔑 Asserted through the REAL container, because the conversion depends
      // on an fx_rates row being reachable from the estimate. A cold cache
      // looks exactly like a working drop.
      const fx: any = container().resolve("fx_rates")
      const existing = await fx.listFxRates({
        base_currency: "inr",
        quote_currency: "eur",
      })
      if (!existing?.length) {
        await fx.createFxRates({
          base_currency: "inr",
          quote_currency: "eur",
          rate: 0.0106,
          fetched_at: new Date(),
          source: "test",
        })
      }

      const { buildShippingEstimate } = await import(
        "../../src/lib/shipping-estimate"
      )
      const est = await buildShippingEstimate(container(), {
        lines: [{ variant_id: seed.variantA.id, quantity: 5 }],
        destination_postal_code: "10115",
        country_code: "de",
        currency_code: "eur",
        carrier: "shiprocket",
        store: { id: seed.storeId, default_location_id: seed.locationId },
      })

      const best = est.calculated[0]
      expect(best).toBeDefined()
      expect(best.currency_code).toBe("eur")
      // 1354 INR at 0.0106 = 14.35 EUR, rounded to the minor unit.
      expect(best.amount).toBeCloseTo(14.35, 2)
      // The working travels with the number, or the price cannot be checked
      // once FX has moved.
      expect(best.fx).toMatchObject({
        original_amount: 1354,
        original_currency_code: "inr",
        fx_rate: 0.0106,
        fx_source: "fx_rates",
      })

      // The INR flat row is still DROPPED, not converted — a manual price is an
      // offer published to buyers billed in that currency.
      expect(est.manual).toEqual([])
    })
    it("does NOT relay a domestic lane the partner can serve", async () => {
      // The relay is a fallback, not a comparison. A Mumbai parcel leaves
      // Srinagar directly, and routing it through Delhi to save money is a
      // logistics decision nobody made.
      const { api } = getSharedTestEnv()
      const res = await api.post(
        "/partners/quotes",
        mintBody(seed, {
          buyer_email: `domestic-${seed.unique}@jaalyantra.test`,
          destination_country_code: "in",
          destination_postal_code: "400001",
        }),
        { headers: seed.headers }
      )

      expect(res.status).toBe(201)
      // The domestic lane's own answer — never one of the intl hub numbers.
      const freight = Number(res.data.quote.quoted_freight)
      expect(freight).not.toBeCloseTo(1354, 2)
      expect(freight).not.toBeCloseTo(2994, 2)
    })
  })
})
