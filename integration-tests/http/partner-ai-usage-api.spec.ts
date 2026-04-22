import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { AI_USAGE_MODULE } from "../../src/modules/ai_usage"
import type AiUsageService from "../../src/modules/ai_usage/service"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartner(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-ai-${unique}@medusa-test.com`

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
      name: `AiTest ${unique}`,
      handle: `aitest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Ai" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { headers, partnerId }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - AI Usage Quota", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartner>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartner(api)
    })

    it("GET /partners/ai/usage returns an initial empty quota", async () => {
      const res = await api.get("/partners/ai/usage", {
        headers: partner.headers,
      })
      expect(res.status).toBe(200)
      expect(res.data.image_describe).toEqual({
        used: 0,
        limit: 10,
        allowed: true,
      })
    })

    it("POST /partners/ai/describe-image returns 402 upgrade_required after 10 uses", async () => {
      // Seed 10 usage events directly via the service — we can't hit the
      // real describe endpoint without a configured Qwen provider, and
      // the quota gate runs before the vision call anyway.
      const container = getContainer()
      const aiUsage = container.resolve(AI_USAGE_MODULE) as unknown as AiUsageService
      for (let i = 0; i < 10; i++) {
        await aiUsage.recordUsage(partner.partnerId, "image_describe", {
          seeded: true,
        })
      }

      // Usage endpoint reflects the seeded events
      const usageRes = await api.get("/partners/ai/usage", {
        headers: partner.headers,
      })
      expect(usageRes.data.image_describe.used).toBe(10)
      expect(usageRes.data.image_describe.allowed).toBe(false)

      // Describe endpoint short-circuits with 402 before trying the model
      const describeRes = await api.post(
        "/partners/ai/describe-image",
        { imageUrl: "https://example.com/x.jpg" },
        { headers: partner.headers, validateStatus: () => true }
      )
      expect(describeRes.status).toBe(402)
      expect(describeRes.data.upgrade_required).toBe(true)
      expect(describeRes.data.code).toBe("ai_quota_exhausted")
      expect(describeRes.data.used).toBe(10)
      expect(describeRes.data.limit).toBe(10)
    })

    it("quota is scoped per partner", async () => {
      const container = getContainer()
      const aiUsage = container.resolve(AI_USAGE_MODULE) as unknown as AiUsageService
      await aiUsage.recordUsage(partner.partnerId, "image_describe")

      // A second partner should still see an empty quota.
      const other = await createPartner(api)
      const otherUsage = await api.get("/partners/ai/usage", {
        headers: other.headers,
      })
      expect(otherUsage.data.image_describe.used).toBe(0)
      expect(otherUsage.data.image_describe.allowed).toBe(true)
    })
  })
})
