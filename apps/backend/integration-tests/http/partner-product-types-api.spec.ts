import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Product Types CRUD", () => {
    let adminHeaders: Record<string, any>
    let partnerHeaders: Record<string, string>
    let partnerId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const partnerEmail = `partner-pt-${unique}@medusa-test.com`

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
          name: `TypeTest ${unique}`,
          handle: `typetest-${unique}`,
          admin: {
            email: partnerEmail,
            first_name: "Admin",
            last_name: "TypeTest",
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

    it("should list product types", async () => {
      const res = await api.get("/partners/product-types", {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(res.data).toHaveProperty("product_types")
      expect(Array.isArray(res.data.product_types)).toBe(true)
      expect(res.data).toHaveProperty("count")
    })

    it("should create a product type", async () => {
      const res = await api.post(
        "/partners/product-types",
        { value: `Test Type ${Date.now()}` },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(201)
      expect(res.data).toHaveProperty("product_type")
      expect(res.data.product_type.value).toContain("Test Type")
      expect(res.data.product_type.id).toBeDefined()
    })

    it("should get a product type by id", async () => {
      const createRes = await api.post(
        "/partners/product-types",
        { value: `Get Type ${Date.now()}` },
        { headers: partnerHeaders }
      )
      const typeId = createRes.data.product_type.id

      const res = await api.get(`/partners/product-types/${typeId}`, {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(res.data).toHaveProperty("product_type")
      expect(res.data.product_type.id).toBe(typeId)
    })

    it("should update a product type", async () => {
      const createRes = await api.post(
        "/partners/product-types",
        { value: `Update Me ${Date.now()}` },
        { headers: partnerHeaders }
      )
      const typeId = createRes.data.product_type.id

      const res = await api.post(
        `/partners/product-types/${typeId}`,
        { value: "Updated Type Name" },
        { headers: partnerHeaders }
      )

      expect(res.status).toBe(200)
      expect(res.data.product_type.value).toBe("Updated Type Name")
    })

    it("should delete a product type", async () => {
      const createRes = await api.post(
        "/partners/product-types",
        { value: `Delete Me ${Date.now()}` },
        { headers: partnerHeaders }
      )
      const typeId = createRes.data.product_type.id

      const res = await api.delete(`/partners/product-types/${typeId}`, {
        headers: partnerHeaders,
      })

      expect(res.status).toBe(200)
      expect(res.data.id).toBe(typeId)
      expect(res.data.deleted).toBe(true)

      // Verify it's gone
      const getRes = await api
        .get(`/partners/product-types/${typeId}`, {
          headers: partnerHeaders,
        })
        .catch((err) => err.response)

      expect(getRes.status).toBe(404)
    })

    it("should reject unauthenticated requests", async () => {
      const res = await api
        .get("/partners/product-types")
        .catch((err) => err.response)

      expect(res.status).toBe(401)
    })
  })
})
