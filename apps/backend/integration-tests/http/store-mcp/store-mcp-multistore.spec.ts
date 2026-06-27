// Mock the deployment module (Vercel + Cloudflare) used by storefront
// provisioning so /partners/stores doesn't hit external services.
jest.mock("../../../src/modules/deployment/service", () => {
  const mockService = {
    isVercelConfigured: jest.fn().mockReturnValue(true),
    isCloudflareConfigured: jest.fn().mockReturnValue(true),
    createProject: jest.fn().mockResolvedValue({ id: "prj_mock", name: "mock" }),
    setEnvironmentVariables: jest.fn().mockResolvedValue(undefined),
    addDomain: jest.fn().mockResolvedValue({ name: "mock.test", verified: false }),
    triggerDeployment: jest
      .fn()
      .mockResolvedValue({ id: "dpl_mock", url: "mock.vercel.app", readyState: "READY" }),
    getProject: jest.fn().mockResolvedValue({ id: "prj_mock", name: "mock" }),
    getDeployment: jest
      .fn()
      .mockResolvedValue({ id: "dpl_mock", url: "mock.vercel.app", readyState: "READY" }),
    createDnsRecord: jest.fn().mockResolvedValue({ id: "dns_mock" }),
    listDnsRecords: jest.fn().mockResolvedValue([]),
    updateDnsRecord: jest.fn().mockResolvedValue({ id: "dns_mock" }),
    deleteDnsRecord: jest.fn().mockResolvedValue(undefined),
    ensureVercelCname: jest
      .fn()
      .mockResolvedValue({ action: "created", record: { id: "dns_mock" } }),
  }
  return jest.fn().mockImplementation(() => mockService)
})

import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(120000)

const MCP_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
}
const rpc = (method: string, params: Record<string, unknown>, id = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  params,
})

const PARTNER_PASSWORD = "TestPartner123!"

async function createPartnerWithAuth(api: any) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `mcp-store-${unique}@test.com`
  const handle = `mcp-store-${unique}`

  await api.post("/auth/partner/emailpass/register", { email, password: PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
  let headers = { Authorization: `Bearer ${login1.data.token}` }

  const createRes = await api.post(
    "/partners",
    { name: `MCP Store Partner ${unique}`, handle, admin: { email, first_name: "Test", last_name: "Partner" } },
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
      store: { name: "MCP Store", supported_currencies: [{ currency_code: "usd", is_default: true }] },
      region: { name: "North America", currency_code: "usd", countries: ["us"] },
      location: {
        name: "Test Warehouse",
        address: { address_1: "123 Test St", city: "New York", province: "NY", postal_code: "10001", country_code: "US" },
      },
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
    publishableKey: storeData.api_key.token,
  }
}

setupSharedTestSuite(() => {
  describe("Store MCP server — multi-tenant store resolution", () => {
    const { api, getContainer } = getSharedTestEnv()

    it("list_stores returns the seeded storefront with its default key", async () => {
      const { partner, storeId, publishableKey } = await fullSetup(api, getContainer)

      const res = await api.post(
        "/mcp",
        rpc("tools/call", { name: "list_stores", arguments: {} }),
        { headers: MCP_HEADERS }
      )
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBeFalsy()

      const payload = JSON.parse(res.data.result.content[0].text)
      const found = payload.stores.find((s: any) => s.handle === partner.handle)
      expect(found).toBeTruthy()
      expect(found.store_id).toBe(storeId)
      expect(found.publishable_key).toBe(publishableKey)
    })

    it("list_stores includes the platform core/default store (is_default)", async () => {
      // The shared env seeds a default (non-partner) store via createDefaultsWorkflow.
      await fullSetup(api, getContainer)

      const res = await api.post(
        "/mcp",
        rpc("tools/call", { name: "list_stores", arguments: {} }),
        { headers: MCP_HEADERS }
      )
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBeFalsy()

      const payload = JSON.parse(res.data.result.content[0].text)
      const def = payload.stores.find((s: any) => s.is_default === true)
      expect(def).toBeTruthy()
      expect(typeof def.store_id).toBe("string")
      // Apex domain is attached (defaults to cicilabel.com / ROOT_DOMAIN).
      expect(typeof def.domain === "string" || def.domain === null).toBe(true)
    })

    it("get_storefront_key resolves the core store via 'default'", async () => {
      await fullSetup(api, getContainer)

      const res = await api.post(
        "/mcp",
        rpc("tools/call", { name: "get_storefront_key", arguments: { store: "default" } }),
        { headers: MCP_HEADERS }
      )
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBeFalsy()

      const info = JSON.parse(res.data.result.content[0].text)
      expect(info.is_default).toBe(true)
      expect(typeof info.store_id).toBe("string")
    })

    it("get_storefront_key resolves the publishable key by handle", async () => {
      const { partner, publishableKey } = await fullSetup(api, getContainer)

      const res = await api.post(
        "/mcp",
        rpc("tools/call", { name: "get_storefront_key", arguments: { store: partner.handle } }),
        { headers: MCP_HEADERS }
      )
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBeFalsy()

      const info = JSON.parse(res.data.result.content[0].text)
      expect(info.handle).toBe(partner.handle)
      expect(info.publishable_key).toBe(publishableKey)
    })

    it("get_storefront_key returns an in-band error for an unknown store", async () => {
      const res = await api.post(
        "/mcp",
        rpc("tools/call", { name: "get_storefront_key", arguments: { store: "no-such-store-xyz-999" } }),
        { headers: MCP_HEADERS }
      )
      expect(res.status).toBe(200)
      expect(res.data?.result?.isError).toBe(true)
      expect(res.data.result.content[0].text).toMatch(/no storefront found/i)
    })

    it("get_product with a `store` arg scopes to that storefront (no key header)", async () => {
      const { partner, adminHeaders, salesChannelId } = await fullSetup(api, getContainer)

      const created = await api.post(
        "/admin/products",
        {
          title: "MCP Store-Arg Product",
          handle: `mcp-store-arg-${Date.now()}`,
          status: "published",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Size", values: ["S"] }],
          variants: [
            {
              title: "Small",
              options: { Size: "S" },
              prices: [{ amount: 2999, currency_code: "usd" }],
              manage_inventory: false,
            },
          ],
        },
        adminHeaders
      )
      const productId = created.data.product.id

      const res = await api.post(
        "/mcp",
        rpc("tools/call", {
          name: "get_product",
          arguments: { store: partner.handle, id: productId, fields: "id,title,handle" },
        }),
        { headers: MCP_HEADERS }
      )
      expect(res.status).toBe(200)
      if (res.data?.result?.isError) {
        // eslint-disable-next-line no-console
        console.log("[mcp-multistore] in-band error:", res.data.result.content?.[0]?.text)
      }
      expect(res.data?.result?.isError).toBeFalsy()

      const payload = JSON.parse(res.data.result.content[0].text)
      expect(payload.product?.id).toBe(productId)
    })
  })
})
