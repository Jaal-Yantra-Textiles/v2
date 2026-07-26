/**
 * #843 (approach #2) — the admin → partner read-proxy.
 *
 * These routes read a partner's internals through the partner portal's OWN
 * scoping helpers, driven by a synthesized `{ actor_id: partnerId }` context.
 * The contract worth pinning is exactly that: admin sees what the partner sees,
 * without a partner login, and cannot write through it.
 */
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartner(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-inspect-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login1.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `InspectTest ${unique}`,
      handle: `inspecttest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Inspect" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  // Re-login so the bearer token carries partner actor context.
  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { headers, partnerId }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin partner inspection read-proxy (#843)", () => {
    let adminHeaders: any
    let partner: Awaited<ReturnType<typeof createPartner>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartner(api)
    })

    describe("GET /admin/partners/:id/orders", () => {
      it("returns the partner's order list without a partner login", async () => {
        const res = await api.get(
          `/admin/partners/${partner.partnerId}/orders`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.orders)).toBe(true)
        expect(res.data).toHaveProperty("count")
        expect(res.data).toHaveProperty("offset")
        expect(res.data).toHaveProperty("limit")
      })

      it("mirrors GET /partners/orders for the same partner and kind", async () => {
        // The whole point of the read-proxy: identical payload shape from the
        // two surfaces. If these ever diverge, the mirror has drifted and the
        // console is lying about what the partner sees.
        for (const kind of ["retail", "design", "inventory", "all"]) {
          const viaAdmin = await api.get(
            `/admin/partners/${partner.partnerId}/orders?kind=${kind}`,
            adminHeaders
          )
          const viaPartner = await api.get(`/partners/orders?kind=${kind}`, {
            headers: partner.headers,
          })

          expect(viaAdmin.status).toBe(200)
          expect(viaPartner.status).toBe(200)
          expect(viaAdmin.data.count).toBe(viaPartner.data.count)
          expect(viaAdmin.data.orders.map((o: any) => o.id)).toEqual(
            viaPartner.data.orders.map((o: any) => o.id)
          )
        }
      })

      it("rejects an unknown kind rather than silently defaulting", async () => {
        const err = await api
          .get(
            `/admin/partners/${partner.partnerId}/orders?kind=nonsense`,
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(400)
      })

      it("404s for an unknown partner instead of a partner-voiced 401", async () => {
        const err = await api
          .get("/admin/partners/partner_does_not_exist/orders", adminHeaders)
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
        expect(err.response.data.message).toBe("Partner not found")
      })

      it("requires admin auth", async () => {
        const err = await api
          .get(`/admin/partners/${partner.partnerId}/orders`)
          .catch((e: any) => e)

        expect(err.response.status).toBe(401)
      })

      it("is read-only — no write verb is exposed", async () => {
        const err = await api
          .post(`/admin/partners/${partner.partnerId}/orders`, {}, adminHeaders)
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })

    describe("GET /admin/partners/:id/onboarding-profile", () => {
      it("returns null when the partner never started the wizard", async () => {
        const res = await api.get(
          `/admin/partners/${partner.partnerId}/onboarding-profile`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.onboarding_profile).toBeNull()
      })

      it("reads back what the partner saved", async () => {
        const body = {
          what_they_sell: "apparel",
          person_type: "manufacturer",
          team_size: 12,
          does_weaving: true,
          completed: true,
        }
        await api.put("/partners/onboarding-profile", body, {
          headers: partner.headers,
        })

        const res = await api.get(
          `/admin/partners/${partner.partnerId}/onboarding-profile`,
          adminHeaders
        )

        expect(res.status).toBe(200)
        expect(res.data.onboarding_profile).toMatchObject(body)
        expect(res.data.onboarding_profile.partner_id).toBe(partner.partnerId)
      })

      it("404s for an unknown partner", async () => {
        const err = await api
          .get(
            "/admin/partners/partner_does_not_exist/onboarding-profile",
            adminHeaders
          )
          .catch((e: any) => e)

        expect(err.response.status).toBe(404)
      })
    })
  })
})
