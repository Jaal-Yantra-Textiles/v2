import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

/**
 * 🔴 The option routes checked that the caller owns the STORE in the path, and
 * never that the option id next to it belongs to that store. Any partner could
 * read, re-price or DELETE any shipping option on the platform — another
 * partner's or the house's — by putting their own store id in the URL, and
 * could create an option inside another partner's service zone.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("partner shipping options belong to the caller's store", () => {
    let adminHeaders: Record<string, any>

    const makePartnerStore = async (tag: string) => {
      const unique = `${tag}-${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const email = `own-${unique}@medusa-test.com`
      await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
      const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
      await api.post(
        "/partners",
        { name: `Own ${unique}`, handle: `own-${unique}`, admin: { email, first_name: "A", last_name: "B" } },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )
      const login2 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
      const headers = { Authorization: `Bearer ${login2.data.token}` }
      const storeRes = await api.post(
        "/partners/stores",
        {
          store: { name: `Own Store ${unique}`, supported_currencies: [{ currency_code: "usd", is_default: true }] },
          sales_channel: { name: `Own ${unique} - Default` },
          region: { name: "Default Region", currency_code: "usd", countries: ["us"] },
          location: {
            name: "Main Warehouse",
            address: { address_1: "1 Main St", city: "New York", postal_code: "10001", country_code: "US" },
          },
        },
        { headers }
      )
      const storeId = storeRes.data.store.id
      const locationId = storeRes.data.location.id
      const zonesRes = await api.get(
        `/admin/stock-locations/${locationId}?fields=*fulfillment_sets,fulfillment_sets.service_zones.id`,
        adminHeaders
      )
      const zoneIds: string[] = (zonesRes.data.stock_location?.fulfillment_sets || []).flatMap(
        (fs: any) => (fs.service_zones || []).map((z: any) => z.id)
      )
      const optionsRes = await api.get(`/admin/shipping-options?service_zone_id=${zoneIds[0]}`, adminHeaders)
      const option = optionsRes.data.shipping_options[0]
      return { headers, storeId, zoneIds, optionId: option.id as string, profileId: option.shipping_profile_id as string }
    }

    const status = (p: Promise<any>) =>
      p.then((r) => r.status).catch((e) => e?.response?.status)

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
      await api.post("/admin/shipping-profiles", { name: "Default Shipping Profile", type: "default" }, adminHeaders)
    })

    it("refuses to read, edit or delete another partner's option through the caller's own store", async () => {
      const a = await makePartnerStore("a")
      const b = await makePartnerStore("b")
      expect(a.optionId).toBeTruthy()

      const url = `/partners/stores/${b.storeId}/shipping-options/${a.optionId}`
      expect(await status(api.get(url, { headers: b.headers }))).toBe(404)
      expect(await status(api.post(url, { name: "Hijacked" }, { headers: b.headers }))).toBe(404)
      expect(await status(api.delete(url, { headers: b.headers }))).toBe(404)

      // A's option is untouched — read back as admin.
      const after = await api.get(`/admin/shipping-options/${a.optionId}`, adminHeaders)
      expect(after.data.shipping_option.name).not.toBe("Hijacked")

      // Control: the owner still can.
      const own = `/partners/stores/${a.storeId}/shipping-options/${a.optionId}`
      expect(await status(api.get(own, { headers: a.headers }))).toBe(200)
      expect(await status(api.post(own, { name: "Renamed by owner" }, { headers: a.headers }))).toBe(200)
    })

    it("refuses to create an option in another partner's service zone", async () => {
      const a = await makePartnerStore("a")
      const b = await makePartnerStore("b")

      const body = (zoneId: string) => ({
        name: "Zone Courier",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: zoneId,
        shipping_profile_id: b.profileId,
        type: { label: "Courier", description: "Courier", code: "zone-courier" },
        prices: [{ amount: 500, currency_code: "usd" }],
      })

      expect(
        await status(api.post(`/partners/stores/${b.storeId}/shipping-options`, body(a.zoneIds[0]), { headers: b.headers }))
      ).toBe(404)
      // Control: B can in its own zone.
      expect(
        await status(api.post(`/partners/stores/${b.storeId}/shipping-options`, body(b.zoneIds[0]), { headers: b.headers }))
      ).toBe(201)
    })
  })
})
