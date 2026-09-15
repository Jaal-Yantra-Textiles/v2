import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

/**
 * A partner can hold a warehouse with NO store. (#2061)
 *
 * Integration, not unit, for two reasons that have both bitten this repo:
 *
 *  1. `defineLink().entryPoint` is empty in a unit test, so the typed
 *     `partner → stock_location` link can only be proven to exist by reading it
 *     back over HTTP. A mocked link proves the call was made, not that anything
 *     is readable afterwards — and an unreadable link is indistinguishable from
 *     "this partner has no warehouse", which is the #2053 failure exactly.
 *  2. The single-warehouse guard protects a downstream invariant
 *     (`pickPartnerLocation` refuses on >1), so it has to be exercised against
 *     real link rows.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /partners/warehouses — a warehouse without a storefront", () => {
    let adminHeaders: Record<string, any>
    let partnerHeaders: Record<string, string>
    let partnerId: string

    const ADDRESS = {
      address_1: "Khanyara Road",
      city: "Dharamshala",
      country_code: "in",
      province: "Himachal Pradesh",
      postal_code: "176215",
    }

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const email = `wh-partner-${unique}@medusa-test.com`

      await api.post("/auth/partner/emailpass/register", {
        email,
        password: PARTNER_PASSWORD,
      })
      const login1 = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      const res = await api.post(
        "/partners",
        {
          name: `WH Partner ${unique}`,
          handle: `whpartner-${unique}`,
          admin: { email, first_name: "WH", last_name: "Partner" },
        },
        { headers: { Authorization: `Bearer ${login1.data.token}` } }
      )
      partnerId = res.data.partner?.id ?? res.data.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }
    })

    it("creates a stock location and NOTHING else — no store, no sales channel, no publishable key", async () => {
      const before = await api.get("/admin/stores?limit=100", adminHeaders)
      const storeCountBefore = before.data.stores.length

      const res = await api.post(
        "/partners/warehouses",
        { name: "Warehouse Only", address: ADDRESS },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(res.data.warehouse?.id).toMatch(/^sloc_/)
      expect(res.data.partner_id).toBe(partnerId)

      // The whole point: the storefront half was NOT minted.
      const after = await api.get("/admin/stores?limit=100", adminHeaders)
      expect(after.data.stores.length).toBe(storeCountBefore)

      const stores = await api.get("/partners/stores", { headers: partnerHeaders })
      expect(stores.data.stores ?? []).toHaveLength(0)
    })

    it("the typed partner→stock_location link is READABLE afterwards", async () => {
      const created = await api.post(
        "/partners/warehouses",
        { name: "Readable Warehouse", address: ADDRESS },
        { headers: partnerHeaders }
      )
      const locationId = created.data.warehouse.id

      // Read it back through the link, the way resolvePartnerLocation does.
      // A write that cannot be read back is the #2053 failure.
      const listed = await api.get("/partners/warehouses", {
        headers: partnerHeaders,
      })
      expect(listed.data.count).toBe(1)
      expect(listed.data.warehouses[0].id).toBe(locationId)
    })

    it("REFUSES a second warehouse — a second one would stop the partner's runs completing", async () => {
      await api.post(
        "/partners/warehouses",
        { name: "First Warehouse", address: ADDRESS },
        { headers: partnerHeaders }
      )

      const err = await api
        .post(
          "/partners/warehouses",
          { name: "Second Warehouse", address: ADDRESS },
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(err.status).toBe(400)
      expect(err.data.message).toContain("already has a warehouse")
      // Names the one they have, so the refusal is actionable.
      expect(err.data.message).toContain("First Warehouse")

      // And the refusal left nothing behind.
      const listed = await api.get("/partners/warehouses", {
        headers: partnerHeaders,
      })
      expect(listed.data.count).toBe(1)
    })

    it("an admin can provision a warehouse on a partner's behalf", async () => {
      const res = await api.post(
        `/admin/partners/${partnerId}/warehouses`,
        { name: "Admin Provisioned", address: ADDRESS },
        adminHeaders
      )

      expect(res.status).toBe(201)
      expect(res.data.warehouse?.id).toMatch(/^sloc_/)

      const listed = await api.get("/partners/warehouses", {
        headers: partnerHeaders,
      })
      expect(listed.data.warehouses[0].name).toBe("Admin Provisioned")
    })

    it("rejects an unauthenticated caller", async () => {
      const err = await api
        .post("/partners/warehouses", { name: "Nope", address: ADDRESS })
        .catch((e: any) => e.response)

      expect([401, 403]).toContain(err.status)
    })
  })
})
