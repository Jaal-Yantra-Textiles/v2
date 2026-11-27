import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createTestCustomer } from "../helpers/create-customer"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(120000)

/**
 * GET /store/delivery-check — the storefront's "do you deliver to my PIN?" box.
 *
 * Carriers are faked at the transport (`DELHIVERY_STUB=1`, `SHIPROCKET_STUB=1`,
 * see each carrier's stub-fetch.ts) — no live API is ever called. The stubs:
 *   Delhivery pin-codes: 799999 → not served, 799998 → prepaid only, else COD
 *   Shiprocket domestic: 799999 → no couriers, else 2 couriers (2 and 4 days)
 *   Shiprocket intl:     origin 176215 → Aramex, 4-6 days
 *
 * Each case uses a different pin because answers are cached per lane for 12h.
 */
const CARRIER_ENV = [
  "DELHIVERY_API_TOKEN",
  "DELHIVERY_STUB",
  "SHIPROCKET_EMAIL",
  "SHIPROCKET_PASSWORD",
  "SHIPROCKET_API_PASSWORD",
  "SHIPROCKET_STUB",
  "SHIPGLOBAL_USERNAME",
  "SHIPGLOBAL_PASSWORD",
] as const

const saved: Record<string, string | undefined> = {}
const clearCarrierEnv = () => {
  for (const k of CARRIER_ENV) delete process.env[k]
}
const stubCarriers = () => {
  clearCarrierEnv()
  process.env.DELHIVERY_API_TOKEN = "test-delhivery-token"
  process.env.DELHIVERY_STUB = "1"
  process.env.SHIPROCKET_EMAIL = "test@shiprocket.example"
  process.env.SHIPROCKET_PASSWORD = "secret"
  process.env.SHIPROCKET_STUB = "1"
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("GET /store/delivery-check", () => {
    let pk: string
    const get = (qs: string) =>
      api.get(`/store/delivery-check?${qs}`, {
        headers: { "x-publishable-api-key": pk },
      })

    beforeAll(async () => {
      for (const k of CARRIER_ENV) saved[k] = process.env[k]

      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      pk = apiKey.token

      // The store ships from Dharamshala (176215), and its only shipping
      // zone covers India + Germany.
      const loc = await api.post(
        "/admin/stock-locations",
        {
          name: "Delivery Check Origin",
          address: {
            address_1: "1 Loom Street",
            city: "Dharamshala",
            country_code: "in",
            postal_code: "176215",
          },
        },
        adminHeaders
      )
      const locationId = loc.data.stock_location.id
      const withSet = await api.post(
        `/admin/stock-locations/${locationId}/fulfillment-sets?fields=*fulfillment_sets`,
        { name: "Delivery Check Shipping", type: "shipping" },
        adminHeaders
      )
      const setId = withSet.data.stock_location.fulfillment_sets[0].id
      await api.post(
        `/admin/fulfillment-sets/${setId}/service-zones`,
        {
          name: "IN + DE",
          geo_zones: [
            { type: "country", country_code: "in" },
            { type: "country", country_code: "de" },
          ],
        },
        adminHeaders
      )

      const storeService: any = container.resolve("store")
      const [store] = await storeService.listStores({}, { take: 1 })
      await storeService.updateStores(store.id, { default_location_id: locationId })
    })

    afterAll(() => {
      for (const k of CARRIER_ENV) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    })

    it("needs a publishable key", async () => {
      const res = await api
        .get(`/store/delivery-check?country_code=in&postal_code=110001`)
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("answers a bad pin politely instead of erroring", async () => {
      stubCarriers()
      const res = await get("country_code=in&postal_code=12345")
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({
        serviceable: null,
        invalid: true,
        message: "Enter a 6-digit PIN code.",
      })
    })

    it("India, both carriers: serviceable, Delhivery COD, Shiprocket ETA", async () => {
      stubCarriers()
      const res = await get("country_code=in&postal_code=110001")
      expect(res.status).toBe(200)
      expect(res.data).toMatchObject({
        serviceable: true,
        cod_available: true,
        eta_days: { min: 2, max: 4 },
        source: ["delhivery", "shiprocket"],
        country_code: "in",
        postal_code: "110001",
        message: "Delivers to PIN 110001 in 2–4 days.",
        cache_hit: false,
      })

      // Second ask for the same lane is served from the cache.
      const again = await get("country_code=in&postal_code=110001")
      expect(again.data.cache_hit).toBe(true)
      expect(again.data.serviceable).toBe(true)
    })

    it("India, prepaid-only pin: Delhivery says no COD even though a Shiprocket courier would", async () => {
      stubCarriers()
      const res = await get("country_code=in&postal_code=799998")
      expect(res.data).toMatchObject({ serviceable: true, cod_available: false })
    })

    it("India, nobody goes there", async () => {
      stubCarriers()
      const res = await get("country_code=in&postal_code=799999")
      expect(res.data).toMatchObject({
        serviceable: false,
        cod_available: false,
        eta_days: null,
        message: "Sorry, we don't deliver to PIN 799999 yet.",
      })
    })

    it("international via Shiprocket from the store's own pin: ETA, never COD", async () => {
      stubCarriers()
      const res = await get("country_code=de&postal_code=10115")
      expect(res.data).toMatchObject({
        serviceable: true,
        cod_available: false,
        eta_days: { min: 6, max: 6 },
        source: ["shiprocket"],
      })
    })

    it("no carrier configured: falls back to the store's shipping zones", async () => {
      clearCarrierEnv()
      const de = await get("country_code=de&postal_code=80331")
      expect(de.data).toMatchObject({
        serviceable: true,
        eta_days: null,
        source: ["store_shipping_zones"],
        message: "We ship to Germany.",
      })

      const jp = await get("country_code=jp&postal_code=100-0001")
      expect(jp.data).toMatchObject({ serviceable: false, eta_days: null })
    })
  })
})
