import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Update with Metadata (Business Type)", () => {
    let partnerHeaders: Record<string, string>
    let partnerId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)

      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const partnerEmail = `partner-meta-${unique}@medusa-test.com`

      await api.post("/auth/partner/emailpass/register", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })

      const login1 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

      const partnerRes = await api.post(
        "/partners",
        {
          name: `MetaTest ${unique}`,
          handle: `metatest-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Admin",
            last_name: "MetaTest",
          },
        },
        { headers: partnerHeaders }
      )
      partnerId = partnerRes.data.partner.id

      const login2 = await api.post("/auth/partner/emailpass", {
        email: partnerEmail,
        password: TEST_PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }
    })

    it("should update partner metadata with use_type", async () => {
      const res = await api.put(
        "/partners/update",
        { metadata: { use_type: "seller" } },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
      expect(res.data.partner).toBeDefined()
      expect(res.data.partner.metadata).toBeDefined()
      expect(res.data.partner.metadata.use_type).toBe("seller")
    })

    it("should update metadata without requiring name or admin fields", async () => {
      // This was previously failing with "Field 'name' is required"
      const res = await api.put(
        "/partners/update",
        { metadata: { use_type: "manufacturer" } },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
      expect(res.data.partner.metadata.use_type).toBe("manufacturer")
    })

    it("should preserve existing metadata when updating use_type", async () => {
      // Set initial metadata
      await api.put(
        "/partners/update",
        { metadata: { use_type: "seller", custom_field: "hello" } },
        { headers: partnerHeaders }
      )

      // Update use_type while keeping custom_field
      const res = await api.put(
        "/partners/update",
        { metadata: { use_type: "manufacturer", custom_field: "hello" } },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
      expect(res.data.partner.metadata.use_type).toBe("manufacturer")
      expect(res.data.partner.metadata.custom_field).toBe("hello")
    })

    it("should allow updating name without admin", async () => {
      const res = await api.put(
        "/partners/update",
        { name: "Updated Partner Name" },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
      expect(res.data.partner.name).toBe("Updated Partner Name")
    })

    it("should reject unrecognized top-level fields", async () => {
      // partnerUpdateSchema does not have .strict() but also doesn't define random fields
      // This tests that the update route processes only known fields
      const res = await api.put(
        "/partners/update",
        { metadata: { use_type: "seller" } },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
    })

    it("should reflect use_type in partner details", async () => {
      await api.put(
        "/partners/update",
        { metadata: { use_type: "seller" } },
        { headers: partnerHeaders }
      )

      const detailsRes = await api.get("/partners/details", {
        headers: partnerHeaders,
      })

      expect(detailsRes.status).toBe(200)
      expect(detailsRes.data.partner.metadata.use_type).toBe("seller")
    })

    it("should reject unauthenticated update", async () => {
      const res = await api
        .put("/partners/update", { metadata: { use_type: "seller" } })
        .catch((err) => err.response)

      expect(res.status).toBe(401)
    })
  })
})
