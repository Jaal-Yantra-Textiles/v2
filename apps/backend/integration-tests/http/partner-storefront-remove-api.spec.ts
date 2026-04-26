import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Storefront Status & Remove", () => {
    let partnerHeaders: Record<string, string>
    let partnerId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)

      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const partnerEmail = `partner-sf-${unique}@medusa-test.com`

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
          name: `SFTest ${unique}`,
          handle: `sftest-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Admin",
            last_name: "SFTest",
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

    it("should return provisioned: false for new partner", async () => {
      const res = await api.get("/partners/storefront", {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(res.data.provisioned).toBe(false)
      expect(res.data).toHaveProperty("vercel_configured")
      expect(res.data).toHaveProperty("cloudflare_configured")
    })

    it("should return 404 when trying to remove non-provisioned storefront", async () => {
      const res = await api
        .delete("/partners/storefront", {
          headers: partnerHeaders,
        })
        .catch((err) => err.response)

      expect(res.status).toBe(404)
      expect(res.data.message).toContain("not been provisioned")
    })

    it("should handle storefront with stale metadata gracefully", async () => {
      // Manually set fake storefront metadata to simulate stale state
      await api.put(
        "/partners/update",
        {
          metadata: {
            vercel_project_id: "fake-project-id-that-does-not-exist",
            vercel_project_name: "fake-project",
            storefront_domain: "fake.example.com",
            storefront_provisioned_at: new Date().toISOString(),
          },
        },
        { headers: partnerHeaders }
      )

      // GET should detect the project is gone (404 from Vercel) and return provisioned: false
      // If Vercel is not configured, it will still show provisioned: true with error
      const res = await api.get("/partners/storefront", {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      // Either provisioned: false (Vercel 404 detected) or provisioned: true with error (Vercel not configured)
      if (res.data.provisioned === false) {
        expect(res.data.message).toBeDefined()
      } else {
        expect(res.data.error).toBeDefined()
      }
    })

    it("should clean up metadata when removing storefront with stale data", async () => {
      // Set fake storefront metadata
      await api.put(
        "/partners/update",
        {
          metadata: {
            vercel_project_id: "fake-project-id",
            vercel_project_name: "fake-project",
            storefront_domain: "fake.example.com",
            storefront_provisioned_at: new Date().toISOString(),
            use_type: "seller",
          },
        },
        { headers: partnerHeaders }
      )

      // Delete should succeed (clears metadata even if Vercel calls fail)
      const deleteRes = await api.delete("/partners/storefront", {
        headers: partnerHeaders,
      })

      expect(deleteRes.status).toBe(200)
      expect(deleteRes.data.message).toBe("Storefront removed")
      expect(deleteRes.data.results.metadata.action).toBe("cleared")

      // Verify storefront metadata is gone but use_type is preserved
      const detailsRes = await api.get("/partners/details", {
        headers: partnerHeaders,
      })

      expect(detailsRes.status).toBe(200)
      const metadata = detailsRes.data.partner.metadata || {}
      expect(metadata.vercel_project_id).toBeUndefined()
      expect(metadata.vercel_project_name).toBeUndefined()
      expect(metadata.storefront_domain).toBeUndefined()
      expect(metadata.storefront_provisioned_at).toBeUndefined()
      // Non-storefront metadata should be preserved
      expect(metadata.use_type).toBe("seller")
    })

    it("should return provisioned: false after removal", async () => {
      // Set and remove fake storefront
      await api.put(
        "/partners/update",
        {
          metadata: {
            vercel_project_id: "fake-id",
            vercel_project_name: "fake",
            storefront_domain: "fake.test.com",
          },
        },
        { headers: partnerHeaders }
      )

      await api.delete("/partners/storefront", {
        headers: partnerHeaders,
      })

      // Now GET should return not provisioned
      const res = await api.get("/partners/storefront", {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(res.data.provisioned).toBe(false)
    })

    it("should reject unauthenticated storefront requests", async () => {
      const getRes = await api
        .get("/partners/storefront")
        .catch((err) => err.response)
      expect(getRes.status).toBe(401)

      const deleteRes = await api
        .delete("/partners/storefront")
        .catch((err) => err.response)
      expect(deleteRes.status).toBe(401)
    })
  })
})
