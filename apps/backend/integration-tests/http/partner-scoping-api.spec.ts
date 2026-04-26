import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

/**
 * Helper to register a partner and return authenticated headers + partner id.
 */
async function createPartnerWithAuth(
  api: any,
  suffix: string
): Promise<{ headers: Record<string, string>; partnerId: string; email: string }> {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6) + suffix
  const email = `partner-scope-${unique}@medusa-test.com`

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
      name: `Scope ${unique}`,
      handle: `scope-${unique}`,
      admin: {
        email,
        first_name: "Admin",
        last_name: `Scope${suffix}`,
      },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { headers, partnerId, email }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Cross-Partner Scoping", () => {
    let partner1: Awaited<ReturnType<typeof createPartnerWithAuth>>
    let partner2: Awaited<ReturnType<typeof createPartnerWithAuth>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)

      partner1 = await createPartnerWithAuth(api, "a")
      partner2 = await createPartnerWithAuth(api, "b")
    })

    it("partner details are scoped — each partner sees only own data", async () => {
      const p1Details = await api.get("/partners/details", {
        headers: partner1.headers,
      })
      const p2Details = await api.get("/partners/details", {
        headers: partner2.headers,
      })

      expect(p1Details.data.partner.id).toBe(partner1.partnerId)
      expect(p2Details.data.partner.id).toBe(partner2.partnerId)
      expect(p1Details.data.partner.id).not.toBe(p2Details.data.partner.id)
    })

    it("partner update metadata is scoped — one partner's metadata doesn't leak", async () => {
      await api.put(
        "/partners/update",
        { metadata: { use_type: "seller", secret: "p1-only" } },
        { headers: partner1.headers }
      )

      await api.put(
        "/partners/update",
        { metadata: { use_type: "manufacturer" } },
        { headers: partner2.headers }
      )

      const p1 = await api.get("/partners/details", {
        headers: partner1.headers,
      })
      const p2 = await api.get("/partners/details", {
        headers: partner2.headers,
      })

      expect(p1.data.partner.metadata.use_type).toBe("seller")
      expect(p1.data.partner.metadata.secret).toBe("p1-only")
      expect(p2.data.partner.metadata.use_type).toBe("manufacturer")
      expect(p2.data.partner.metadata.secret).toBeUndefined()
    })

    it("product types list is global — both partners see the same types", async () => {
      // Product types are global (not store-scoped), so both should see them
      const createRes = await api.post(
        "/partners/product-types",
        { value: `Shared Type ${Date.now()}` },
        { headers: partner1.headers }
      )
      const typeId = createRes.data.product_type.id

      const p1List = await api.get("/partners/product-types", {
        headers: partner1.headers,
      })
      const p2List = await api.get("/partners/product-types", {
        headers: partner2.headers,
      })

      const p1Has = p1List.data.product_types.some((t: any) => t.id === typeId)
      const p2Has = p2List.data.product_types.some((t: any) => t.id === typeId)

      expect(p1Has).toBe(true)
      expect(p2Has).toBe(true)
    })

    it("storefront status is scoped per partner", async () => {
      // Set fake storefront metadata on partner 1 only
      await api.put(
        "/partners/update",
        {
          metadata: {
            vercel_project_id: "fake-p1-project",
            storefront_domain: "p1.example.com",
          },
        },
        { headers: partner1.headers }
      )

      const p1Status = await api.get("/partners/storefront", {
        headers: partner1.headers,
      })
      const p2Status = await api.get("/partners/storefront", {
        headers: partner2.headers,
      })

      // Partner 1 has storefront metadata (will try to fetch from Vercel or show error)
      // Partner 2 has no storefront
      expect(p2Status.data.provisioned).toBe(false)
      // p1 either shows provisioned: true (with error since fake) or false (if 404 cleanup triggered)
      // Either way, their data should be different
      expect(p1Status.data).not.toEqual(p2Status.data)
    })
  })
})
