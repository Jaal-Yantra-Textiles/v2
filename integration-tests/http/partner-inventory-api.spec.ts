import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-inv-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `InvTest ${unique}`,
      handle: `invtest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Inv" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `InvStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    storeId: storeRes.data.store.id,
    locationId: storeRes.data.location.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Inventory Management", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("GET /partners/inventory-items", () => {
      it("should list inventory items (initially empty)", async () => {
        const res = await api.get("/partners/inventory-items", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.inventory_items)).toBe(true)
      })
    })

    describe("POST /partners/inventory-items", () => {
      it("should create an inventory item", async () => {
        const unique = Date.now()
        const res = await api.post(
          "/partners/inventory-items",
          {
            sku: `TEST-INV-${unique}`,
            title: `Test Item ${unique}`,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.inventory_item).toBeDefined()
        expect(res.data.inventory_item.sku).toBe(`TEST-INV-${unique}`)
      })

      it("should show created item in list", async () => {
        const unique = Date.now()
        const createRes = await api.post(
          "/partners/inventory-items",
          {
            sku: `LIST-INV-${unique}`,
            title: `List Item ${unique}`,
          },
          { headers: partner.headers }
        )
        const itemId = createRes.data.inventory_item.id

        const listRes = await api.get("/partners/inventory-items", {
          headers: partner.headers,
        })
        expect(listRes.status).toBe(200)
        const found = listRes.data.inventory_items.some((i: any) => i.id === itemId)
        expect(found).toBe(true)
      })
    })

    describe("Inventory Item Details", () => {
      let itemId: string

      beforeEach(async () => {
        const res = await api.post(
          "/partners/inventory-items",
          {
            sku: `DETAIL-${Date.now()}`,
            title: "Detail Item",
          },
          { headers: partner.headers }
        )
        itemId = res.data.inventory_item.id
      })

      it("GET /partners/inventory-items/:id returns item details", async () => {
        const res = await api.get(`/partners/inventory-items/${itemId}`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.inventory_item).toBeDefined()
        expect(res.data.inventory_item.id).toBe(itemId)
      })

      it("GET /partners/inventory-items/:id/levels returns inventory levels", async () => {
        const res = await api.get(`/partners/inventory-items/${itemId}/levels`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.inventory_levels)).toBe(true)
      })
    })

    describe("GET /partners/inventory-orders", () => {
      it("should list inventory orders (initially empty)", async () => {
        const res = await api.get("/partners/inventory-orders", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.inventory_orders)).toBe(true)
      })
    })
  })
})
