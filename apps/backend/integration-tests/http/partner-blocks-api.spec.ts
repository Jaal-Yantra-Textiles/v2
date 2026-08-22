import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(60 * 1000)

async function createPartnerWithAuth(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-blocks-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })

  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers = { Authorization: `Bearer ${login1.data.token}` }

  const createRes = await api.post(
    "/partners",
    {
      name: `BlocksTest ${unique}`,
      handle: `blocks-test-${unique}`,
      admin: {
        email,
        first_name: "Blocks",
        last_name: "Tester",
      },
    },
    { headers }
  )
  const partnerId = createRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { partnerId, headers, email }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner Storefront Blocks API", () => {
    let adminHeaders: Record<string, any>
    let partnerHeaders: Record<string, string>
    let partnerId: string
    let websiteId: string
    let pageId: string

    beforeEach(async () => {
      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)

      // Create a partner
      const partner = await createPartnerWithAuth(api)
      partnerHeaders = partner.headers
      partnerId = partner.partnerId

      // Create a website via admin API
      const domain = `blocks-test-${Date.now()}.jyt.test`
      const websiteRes = await api.post(
        "/admin/websites",
        {
          domain,
          name: "Blocks Test Website",
          status: "Active",
          primary_language: "en",
        },
        adminHeaders
      )
      websiteId = websiteRes.data.website.id

      // Create a page via admin API
      const pageRes = await api.post(
        `/admin/websites/${websiteId}/pages`,
        {
          title: "Test Page",
          slug: "test-page",
          content: "Test content",
          page_type: "Custom",
          status: "Published",
        },
        adminHeaders
      )
      pageId = pageRes.data.page.id

      // Link the partner to the website by setting storefront_domain
      const partnerModule = getContainer().resolve("partner")
      await partnerModule.updatePartners({
        id: partnerId,
        storefront_domain: domain,
        website_id: websiteId,
      })
    })

    describe("GET /partners/storefront/pages/:pageId/blocks", () => {
      it("should list blocks for a partner's page", async () => {
        // Seed a block via admin API
        await api.post(
          `/admin/websites/${websiteId}/pages/${pageId}/blocks`,
          {
            blocks: [
              {
                name: "Hero",
                type: "Hero",
                content: { title: "Welcome" },
                status: "Active",
              },
            ],
          },
          adminHeaders
        )

        const res = await api.get(
          `/partners/storefront/pages/${pageId}/blocks`,
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(200)
        expect(res.data.blocks).toHaveLength(1)
        expect(res.data.blocks[0].type).toBe("Hero")
      })
    })

    describe("POST /partners/storefront/pages/:pageId/blocks", () => {
      it("should create a block via partner API", async () => {
        const res = await api.post(
          `/partners/storefront/pages/${pageId}/blocks`,
          {
            blocks: [
              {
                name: "Main Hero",
                type: "Hero",
                content: { title: "Welcome", subtitle: "To our site" },
                status: "Active",
                order: 0,
              },
            ],
          },
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(201)
        expect(res.data.blocks).toHaveLength(1)
        expect(res.data.blocks[0].type).toBe("Hero")
        expect(res.data.blocks[0].name).toBe("Main Hero")
      })

      it("should return friendly error for duplicate unique block type", async () => {
        // Create a Hero block first
        await api.post(
          `/partners/storefront/pages/${pageId}/blocks`,
          {
            blocks: [
              {
                name: "First Hero",
                type: "Hero",
                content: { title: "Welcome" },
                status: "Active",
              },
            ],
          },
          { headers: partnerHeaders }
        )

        // Try to create another Hero
        const res = await api
          .post(
            `/partners/storefront/pages/${pageId}/blocks`,
            {
              blocks: [
                {
                  name: "Duplicate Hero",
                  type: "Hero",
                  content: { title: "Welcome again" },
                  status: "Active",
                },
              ],
            },
            { headers: partnerHeaders }
          )
          .catch((e) => e.response)

        expect(res.status).toBe(400)
        expect(res.data.errors).toBeDefined()
        expect(res.data.errors[0].error).toContain("Hero")
        expect(res.data.errors[0].error).toContain("already exists")
      })

      it("should return 207 for partial batch with unique duplicate + valid repeatable", async () => {
        // Create a Hero block first
        await api.post(
          `/partners/storefront/pages/${pageId}/blocks`,
          {
            blocks: [
              {
                name: "First Hero",
                type: "Hero",
                content: { title: "Welcome" },
                status: "Active",
              },
            ],
          },
          { headers: partnerHeaders }
        )

        // Batch: duplicate Hero + valid Feature
        const res = await api
          .post(
            `/partners/storefront/pages/${pageId}/blocks`,
            {
              blocks: [
                {
                  name: "Dup Hero",
                  type: "Hero",
                  content: { title: "Nope" },
                  status: "Active",
                },
                {
                  name: "Feature 1",
                  type: "Feature",
                  content: { title: "Feature" },
                  status: "Active",
                },
              ],
            },
            { headers: partnerHeaders }
          )
          .catch((e) => e.response)

        expect(res.status).toBe(207)
        expect(res.data.blocks).toHaveLength(1)
        expect(res.data.blocks[0].type).toBe("Feature")
        expect(res.data.errors).toHaveLength(1)
        expect(res.data.errors[0].error).toContain("Hero")
      })

      it("should allow multiple repeatable block types", async () => {
        const res = await api.post(
          `/partners/storefront/pages/${pageId}/blocks`,
          {
            blocks: [
              {
                name: "Gallery 1",
                type: "Gallery",
                content: { images: [] },
                status: "Active",
              },
              {
                name: "Gallery 2",
                type: "Gallery",
                content: { images: [] },
                status: "Active",
              },
            ],
          },
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(201)
        expect(res.data.blocks).toHaveLength(2)
      })
    })

    describe("PUT /partners/storefront/pages/:pageId/blocks/:blockId", () => {
      let blockId: string

      beforeEach(async () => {
        const res = await api.post(
          `/partners/storefront/pages/${pageId}/blocks`,
          {
            blocks: [
              {
                name: "Feature Block",
                type: "Feature",
                content: { title: "Original" },
                status: "Active",
              },
            ],
          },
          { headers: partnerHeaders }
        )
        blockId = res.data.blocks[0].id
      })

      it("should update block content via partner API", async () => {
        const res = await api.put(
          `/partners/storefront/pages/${pageId}/blocks/${blockId}`,
          {
            content: { title: "Updated" },
            name: "Updated Feature",
          },
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(200)
        expect(res.data.block.name).toBe("Updated Feature")
        expect(res.data.block.content).toEqual({ title: "Updated" })
      })

      it("should update block order via partner API", async () => {
        const res = await api.put(
          `/partners/storefront/pages/${pageId}/blocks/${blockId}`,
          { order: 5 },
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(200)
        expect(res.data.block.order).toBe(5)
      })
    })

    describe("DELETE /partners/storefront/pages/:pageId/blocks/:blockId", () => {
      it("should delete block via partner API", async () => {
        const createRes = await api.post(
          `/partners/storefront/pages/${pageId}/blocks`,
          {
            blocks: [
              {
                name: "To Delete",
                type: "Custom",
                content: {},
                status: "Active",
              },
            ],
          },
          { headers: partnerHeaders }
        )
        const blockId = createRes.data.blocks[0].id

        const res = await api.delete(
          `/partners/storefront/pages/${pageId}/blocks/${blockId}`,
          { headers: partnerHeaders }
        )

        expect(res.status).toBe(200)

        // Verify deleted
        const getRes = await api
          .get(
            `/partners/storefront/pages/${pageId}/blocks`,
            { headers: partnerHeaders }
          )
          .catch((e) => e.response)
        expect(getRes.data.blocks.find((b: any) => b.id === blockId)).toBeUndefined()
      })
    })
  })
})
