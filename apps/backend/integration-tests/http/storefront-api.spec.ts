// Mock the deployment module (Vercel + Cloudflare) used by storefront provisioning
jest.mock("../../src/modules/deployment/service", () => {
  const mockService = {
    isVercelConfigured: jest.fn().mockReturnValue(true),
    isCloudflareConfigured: jest.fn().mockReturnValue(true),
    createProject: jest.fn().mockResolvedValue({ id: "prj_mock", name: "mock-project" }),
    setEnvironmentVariables: jest.fn().mockResolvedValue(undefined),
    addDomain: jest.fn().mockResolvedValue({ name: "mock.cicilabel.com", verified: false }),
    triggerDeployment: jest.fn().mockResolvedValue({ id: "dpl_mock", url: "mock.vercel.app", readyState: "READY" }),
    getProject: jest.fn().mockResolvedValue({ id: "prj_mock", name: "mock-project" }),
    getDeployment: jest.fn().mockResolvedValue({ id: "dpl_mock", url: "mock.vercel.app", readyState: "READY" }),
    createDnsRecord: jest.fn().mockResolvedValue({ id: "dns_mock", type: "CNAME", name: "mock.cicilabel.com", content: "cname.vercel-dns.com" }),
    listDnsRecords: jest.fn().mockResolvedValue([]),
    updateDnsRecord: jest.fn().mockResolvedValue({ id: "dns_mock" }),
    deleteDnsRecord: jest.fn().mockResolvedValue(undefined),
    ensureVercelCname: jest.fn().mockResolvedValue({ action: "created", record: { id: "dns_mock", name: "mock.cicilabel.com", content: "cname.vercel-dns.com" } }),
  }
  return jest.fn().mockImplementation(() => mockService)
})

import { setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(120 * 1000)

const PARTNER_PASSWORD = "TestPartner123!"

async function createPartnerWithAuth(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `sf-e2e-${unique}@test.com`
  const handle = `sf-e2e-${unique}`

  await api.post("/auth/partner/emailpass/register", { email, password: PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  let headers = { Authorization: `Bearer ${login1.data.token}` }

  const createRes = await api.post(
    "/partners",
    { name: `SF E2E Partner ${unique}`, handle, admin: { email, first_name: "Test", last_name: "Partner" } },
    { headers }
  )
  const partnerId = createRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  return { partnerId, headers: { headers }, email, handle }
}

async function createStoreForPartner(api: any, partnerHeaders: any) {
  const res = await api.post(
    "/partners/stores",
    {
      store: { name: "SF E2E Store", supported_currencies: [{ currency_code: "usd", is_default: true }] },
      region: { name: "North America", currency_code: "usd", countries: ["us"] },
      location: { name: "Test Warehouse", address: { address_1: "123 Test St", city: "New York", province: "NY", postal_code: "10001", country_code: "US" } },
    },
    partnerHeaders
  )
  return res.data
}

async function fullSetup(api: any, getContainer: any) {
  const container = await getContainer()
  await createAdminUser(container)
  const adminHeaders = await getAuthHeaders(api)
  const partner = await createPartnerWithAuth(api)
  const storeData = await createStoreForPartner(api, partner.headers)

  return {
    adminHeaders,
    partner,
    storeId: storeData.store.id,
    salesChannelId: storeData.sales_channel.id,
    regionId: storeData.region.id,
    publishableKey: storeData.api_key.token,
  }
}

setupSharedTestSuite(({ api, getContainer }) => {
  describe("Storefront API - End-to-End", () => {
    // DB is torn down after each test, so each test creates its own data via fullSetup

    test("GET /store/regions returns US region via publishable key and GET /store/regions/:id works", async () => {
      const { regionId, publishableKey } = await fullSetup(api, getContainer)

      // List regions
      const listRes = await api.get("/store/regions", {
        headers: { "x-publishable-api-key": publishableKey },
      })
      expect(listRes.status).toBe(200)
      expect(listRes.data.regions.length).toBeGreaterThan(0)

      const usRegion = listRes.data.regions.find((r: any) =>
        r.countries?.some((c: any) => c.iso_2 === "us")
      )
      expect(usRegion).toBeTruthy()
      expect(usRegion.currency_code).toBe("usd")

      // Retrieve specific region
      const getRes = await api.get(`/store/regions/${regionId}`, {
        headers: { "x-publishable-api-key": publishableKey },
      })
      expect(getRes.status).toBe(200)
      expect(getRes.data.region.id).toBe(regionId)
    })

    test("GET /store/customers/me does not return 500 without auth", async () => {
      // This test doesn't need a partner/store — just need a valid publishable key
      // Since DB is torn down, we need to create fresh data
      const setup = await fullSetup(api, getContainer)

      try {
        await api.get("/store/customers/me", {
          headers: { "x-publishable-api-key": setup.publishableKey },
        })
        // If it succeeds, that's fine too (unlikely without auth)
      } catch (err: any) {
        // 400 or 401 are acceptable — 500 is NOT
        expect(err.response.status).toBeLessThan(500)
      }
    })

    test("GET /store/products returns products scoped to publishable key", async () => {
      const { adminHeaders, salesChannelId, regionId, publishableKey } = await fullSetup(api, getContainer)

      // Create a product in the sales channel
      const createRes = await api.post(
        "/admin/products",
        {
          title: "SF Test Product",
          handle: "sf-test-product",
          status: "published",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Size", values: ["S", "M", "L"] }],
          variants: [{
            title: "Small",
            options: { Size: "S" },
            prices: [{ amount: 2999, currency_code: "usd" }],
            manage_inventory: false,
          }],
        },
        adminHeaders
      )
      expect(createRes.status).toBe(200)
      const productId = createRes.data.product.id

      // List products via store API
      const listRes = await api.get("/store/products", {
        headers: { "x-publishable-api-key": publishableKey },
      })
      expect(listRes.status).toBe(200)
      const product = listRes.data.products.find((p: any) => p.id === productId)
      expect(product).toBeTruthy()
      expect(product.handle).toBe("sf-test-product")

      // Get product by handle with prices
      const byHandleRes = await api.get("/store/products", {
        headers: { "x-publishable-api-key": publishableKey },
        params: {
          handle: "sf-test-product",
          region_id: regionId,
          fields: "*variants.calculated_price,+variants.inventory_quantity",
        },
      })
      expect(byHandleRes.status).toBe(200)
      expect(byHandleRes.data.products.length).toBe(1)
      expect(byHandleRes.data.products[0].variants.length).toBeGreaterThan(0)
    })

    // Regression: upstream Medusa's /store/products bypass for category/tag
    // filters checks `filterableFields.category_id` after the validator has
    // already renamed it to `categories.id`, so the request hits the index
    // engine which doesn't index product.categories -> 500.
    // We override the route locally (apps/backend/src/api/store/products/route.ts)
    // to check both names.
    test("GET /store/products?category_id filters by product category without 500", async () => {
      const { adminHeaders, salesChannelId, publishableKey } = await fullSetup(api, getContainer)

      const catRes = await api.post(
        "/admin/product-categories",
        { name: "SF Test Category", handle: "sf-test-category", is_active: true, is_internal: false },
        adminHeaders
      )
      expect(catRes.status).toBe(200)
      const categoryId = catRes.data.product_category.id

      const prodRes = await api.post(
        "/admin/products",
        {
          title: "SF Category Product",
          handle: "sf-category-product",
          status: "published",
          sales_channels: [{ id: salesChannelId }],
          categories: [{ id: categoryId }],
          options: [{ title: "Size", values: ["S"] }],
          variants: [{
            title: "Small",
            options: { Size: "S" },
            prices: [{ amount: 2999, currency_code: "usd" }],
            manage_inventory: false,
          }],
        },
        adminHeaders
      )
      expect(prodRes.status).toBe(200)
      const productId = prodRes.data.product.id

      const listRes = await api.get("/store/products", {
        headers: { "x-publishable-api-key": publishableKey },
        params: { "category_id[]": categoryId },
      })
      expect(listRes.status).toBe(200)
      const product = listRes.data.products.find((p: any) => p.id === productId)
      expect(product).toBeTruthy()
    })

    test("GET /web/storefront/:subdomain resolves partner correctly", async () => {
      const { partner, storeId, salesChannelId, publishableKey } = await fullSetup(api, getContainer)

      const res = await api.get(`/web/storefront/${partner.handle}`)
      expect(res.status).toBe(200)
      expect(res.data.partner.handle).toBe(partner.handle)
      expect(res.data.store.id).toBe(storeId)
      expect(res.data.publishable_key).toBe(publishableKey)
      expect(res.data.sales_channel_id).toBe(salesChannelId)
    })

    test("GET /web/storefront/nonexistent returns 404", async () => {
      try {
        await api.get("/web/storefront/nonexistent-xyz-999")
        fail("Expected 404")
      } catch (err: any) {
        expect(err.response.status).toBe(404)
      }
    })

    test("GET /web/storefront/resolve?host=<handle>.<base> resolves by subdomain", async () => {
      const { partner, storeId, salesChannelId, publishableKey } =
        await fullSetup(api, getContainer)

      const host = `${partner.handle}.jaalyantra.com`
      const res = await api.get("/web/storefront/resolve", { params: { host } })

      expect(res.status).toBe(200)
      expect(res.data.host).toBe(host)
      expect(res.data.publishable_key).toBe(publishableKey)
      expect(res.data.sales_channel_id).toBe(salesChannelId)
      expect(res.data.store.id).toBe(storeId)
      expect(res.data.partner.handle).toBe(partner.handle)
    })

    test("GET /web/storefront/resolve?host=<custom domain> resolves by storefront_domain", async () => {
      const { partner, publishableKey } = await fullSetup(api, getContainer)

      // Attach a custom domain to the partner, then resolve by that exact host.
      const container = await getContainer()
      const partnerService: any = container.resolve("partner")
      const customDomain = `shop-${Date.now()}.example-brand.com`
      await partnerService.updatePartners({
        id: partner.partnerId,
        storefront_domain: customDomain,
      })

      const res = await api.get("/web/storefront/resolve", {
        params: { host: customDomain },
      })

      expect(res.status).toBe(200)
      expect(res.data.host).toBe(customDomain)
      expect(res.data.publishable_key).toBe(publishableKey)
    })

    test("GET /web/storefront/resolve?host=<alias> resolves via website_domain", async () => {
      const { partner, publishableKey } = await fullSetup(api, getContainer)

      const container = await getContainer()
      const partnerService: any = container.resolve("partner")
      const websiteService: any = container.resolve("websites")

      const unique = Date.now()
      // A website the partner owns, plus an alias domain attached later.
      const website = await websiteService.createWebsites({
        domain: `w-${unique}.example.com`,
        name: "Alias Test Website",
      })
      await partnerService.updatePartners({
        id: partner.partnerId,
        website_id: website.id,
      })

      const alias = `shop-${unique}.custom-brand.com`
      await websiteService.createWebsiteDomains({
        domain: alias,
        is_primary: false,
        website_id: website.id,
      })

      const res = await api.get("/web/storefront/resolve", {
        params: { host: alias },
      })

      expect(res.status).toBe(200)
      expect(res.data.host).toBe(alias)
      expect(res.data.publishable_key).toBe(publishableKey)
    })

    test("GET /web/storefront/resolve without host returns 400", async () => {
      try {
        await api.get("/web/storefront/resolve")
        fail("Expected 400")
      } catch (err: any) {
        expect(err.response.status).toBe(400)
      }
    })

    test("GET /web/storefront/resolve?host=<unknown> returns 404", async () => {
      try {
        await api.get("/web/storefront/resolve", {
          params: { host: "nope.unknown-xyz-999.com" },
        })
        fail("Expected 404")
      } catch (err: any) {
        expect(err.response.status).toBe(404)
      }
    })
  })
})
