import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

/**
 * Create a partner with a fully-provisioned store (sales channel + region +
 * location) so the store has a `default_sales_channel_id` to disable.
 */
async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-ds-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const headers1: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  await api.post(
    "/partners",
    {
      name: `DS Partner ${unique}`,
      handle: `dspartner-${unique}`,
      admin: { email, first_name: "Admin", last_name: "DS" },
    },
    { headers: headers1 }
  )

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  const headers: Record<string, string> = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `DS Store ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `DS Channel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  const store = storeRes.data.store
  const salesChannelId = store.default_sales_channel_id || storeRes.data.sales_channel?.id

  return { storeId: store.id, salesChannelId, headers }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin API - Store disable/enable (default sales channel)", () => {
    let adminHeaders: Record<string, any>
    let store: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      store = await createPartnerWithStore(api, adminHeaders)
    })

    const readChannel = async (channelId: string) => {
      const res = await api.get(`/admin/sales-channels/${channelId}`, adminHeaders)
      return res.data.sales_channel
    }

    it("POST /admin/stores/:id/disable disables the store's default sales channel", async () => {
      const res = await api.post(`/admin/stores/${store.storeId}/disable`, {}, adminHeaders)
      expect(res.status).toBe(200)
      expect(res.data.disabled).toBe(true)
      expect(res.data.sales_channel_id).toBe(store.salesChannelId)

      // Read the channel back — the assertion is on the persisted row, not the
      // echoed response, so a route that reports success without writing fails.
      const channel = await readChannel(store.salesChannelId)
      expect(channel.is_disabled).toBe(true)
    })

    it("POST /admin/stores/:id/enable re-enables a disabled store", async () => {
      await api.post(`/admin/stores/${store.storeId}/disable`, {}, adminHeaders)

      const res = await api.post(`/admin/stores/${store.storeId}/enable`, {}, adminHeaders)
      expect(res.status).toBe(200)
      expect(res.data.disabled).toBe(false)

      const channel = await readChannel(store.salesChannelId)
      expect(channel.is_disabled).toBe(false)
    })

    it("returns 404 for a store that does not exist", async () => {
      const res = await api.post(
        `/admin/stores/store_nonexistent/disable`,
        {},
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(res.status).toBe(404)
    })
  })
})