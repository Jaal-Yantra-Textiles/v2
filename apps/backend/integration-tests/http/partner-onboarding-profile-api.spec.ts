import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartner(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-onb-${unique}@medusa-test.com`

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
      name: `OnbTest ${unique}`,
      handle: `onbtest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Onb" },
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

  describe("Partner Onboarding Profile API (#648 slice 1)", () => {
    let partner: Awaited<ReturnType<typeof createPartner>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      await getAuthHeaders(api)
      partner = await createPartner(api)
    })

    it("GET returns null before the wizard is started", async () => {
      const res = await api.get("/partners/onboarding-profile", {
        headers: partner.headers,
      })
      expect(res.status).toBe(200)
      expect(res.data.onboarding_profile).toBeNull()
    })

    it("PUT creates then reads back the profile for the partner", async () => {
      const body = {
        what_they_sell: "apparel",
        price_range: "premium",
        has_inventory_info: true,
        does_stock: false,
        does_weaving: true,
        person_type: "manufacturer",
        team_size: 12,
        payment_collection: "through_us",
        completed: true,
      }

      const put = await api.put("/partners/onboarding-profile", body, {
        headers: partner.headers,
      })
      expect(put.status).toBe(200)
      expect(put.data.onboarding_profile).toMatchObject(body)
      expect(put.data.onboarding_profile.partner_id).toBe(partner.partnerId)

      const get = await api.get("/partners/onboarding-profile", {
        headers: partner.headers,
      })
      expect(get.status).toBe(200)
      expect(get.data.onboarding_profile).toMatchObject(body)
    })

    it("PUT upserts (second call updates, does not duplicate)", async () => {
      const first = await api.put(
        "/partners/onboarding-profile",
        { what_they_sell: "fabric", completed: false },
        { headers: partner.headers }
      )
      const firstId = first.data.onboarding_profile.id

      const second = await api.put(
        "/partners/onboarding-profile",
        { price_range: "luxury", completed: true },
        { headers: partner.headers }
      )
      expect(second.data.onboarding_profile.id).toBe(firstId)
      expect(second.data.onboarding_profile.what_they_sell).toBe("fabric")
      expect(second.data.onboarding_profile.price_range).toBe("luxury")
      expect(second.data.onboarding_profile.completed).toBe(true)
    })

    it("PUT rejects an invalid enum value with 400", async () => {
      const res = await api
        .put(
          "/partners/onboarding-profile",
          { what_they_sell: "spaceships" },
          { headers: partner.headers }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("PUT rejects an unknown field with 400 (strict schema)", async () => {
      const res = await api
        .put(
          "/partners/onboarding-profile",
          { not_a_real_field: "x" },
          { headers: partner.headers }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
    })

    it("requires partner authentication", async () => {
      const res = await api
        .get("/partners/onboarding-profile")
        .catch((e: any) => e.response)
      expect([401, 403]).toContain(res.status)
    })
  })
})
