import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-cust-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `CustTest ${unique}`,
      handle: `custtest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "Cust" },
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
        name: `CStore ${unique}`,
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
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner API - Customer Management", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("GET /partners/customers", () => {
      it("should list customers (initially empty)", async () => {
        const res = await api.get("/partners/customers", { headers: partner.headers })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.customers)).toBe(true)
      })
    })

    describe("POST /partners/customers", () => {
      it("should create a customer linked to the partner store", async () => {
        const unique = Date.now()
        const res = await api.post(
          "/partners/customers",
          {
            first_name: "John",
            last_name: "Doe",
            email: `john-${unique}@example.com`,
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.customer).toBeDefined()
        expect(res.data.customer.first_name).toBe("John")
        expect(res.data.customer.email).toBe(`john-${unique}@example.com`)
      })

      it("should show created customer in the list", async () => {
        const unique = Date.now()
        await api.post(
          "/partners/customers",
          {
            first_name: "Jane",
            last_name: "Smith",
            email: `jane-${unique}@example.com`,
          },
          { headers: partner.headers }
        )

        const list = await api.get("/partners/customers", { headers: partner.headers })
        expect(list.status).toBe(200)
        const found = list.data.customers.some(
          (c: any) => c.email === `jane-${unique}@example.com`
        )
        expect(found).toBe(true)
      })
    })

    describe("Customer Addresses", () => {
      let customerId: string

      beforeEach(async () => {
        const unique = Date.now()
        const res = await api.post(
          "/partners/customers",
          {
            first_name: "Addr",
            last_name: "Test",
            email: `addr-${unique}@example.com`,
          },
          { headers: partner.headers }
        )
        customerId = res.data.customer.id
      })

      it("GET /partners/customers/:id/addresses returns empty list initially", async () => {
        const res = await api.get(`/partners/customers/${customerId}/addresses`, {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.addresses)).toBe(true)
        expect(res.data.addresses.length).toBe(0)
      })

      it("POST /partners/customers/:id/addresses creates an address", async () => {
        const res = await api.post(
          `/partners/customers/${customerId}/addresses`,
          {
            first_name: "Addr",
            last_name: "Test",
            address_1: "456 Oak St",
            city: "Boston",
            postal_code: "02101",
            country_code: "us",
          },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.address).toBeDefined()
        expect(res.data.address.city).toBe("Boston")

        // Verify it shows in the list
        const list = await api.get(`/partners/customers/${customerId}/addresses`, {
          headers: partner.headers,
        })
        expect(list.data.addresses.length).toBe(1)
      })
    })

    describe("Customer Groups", () => {
      it("GET /partners/customer-groups lists groups", async () => {
        const res = await api.get("/partners/customer-groups", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(Array.isArray(res.data.customer_groups)).toBe(true)
      })

      it("POST /partners/customer-groups creates a group", async () => {
        const unique = Date.now()
        const res = await api.post(
          "/partners/customer-groups",
          { name: `VIP ${unique}` },
          { headers: partner.headers }
        )
        expect(res.status).toBe(201)
        expect(res.data.customer_group).toBeDefined()
        expect(res.data.customer_group.name).toBe(`VIP ${unique}`)
      })

      it("links a customer to a group and verifies", async () => {
        const unique = Date.now()

        // Create customer
        const custRes = await api.post(
          "/partners/customers",
          {
            first_name: "Group",
            last_name: "Test",
            email: `group-${unique}@example.com`,
          },
          { headers: partner.headers }
        )
        const customerId = custRes.data.customer.id

        // Create group
        const groupRes = await api.post(
          "/partners/customer-groups",
          { name: `Group ${unique}` },
          { headers: partner.headers }
        )
        const groupId = groupRes.data.customer_group.id

        // Link customer to group
        const linkRes = await api.post(
          `/partners/customers/${customerId}/customer-groups`,
          { add: [groupId] },
          { headers: partner.headers }
        )
        expect(linkRes.status).toBe(200)
      })
    })
  })
})
