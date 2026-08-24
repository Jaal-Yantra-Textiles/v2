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

      /**
       * #1515. Core's unique index on `customer` is `(email, has_account)` and
       * it is PLATFORM-WIDE, so this route's unconditional create turned any
       * buyer who already existed anywhere into core's raw 400 — a message
       * naming another store's data, shown verbatim in the partner UI. It bit
       * the highest-value case: a buyer who already shops somewhere on the
       * platform is exactly the one a partner wants to add.
       */
      it("🔴 ADOPTS a buyer who already exists elsewhere on the platform, and says so", async () => {
        const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
        const email = `adopt-${unique}@example.com`

        // Somebody else's customer, with somebody else's profile on it.
        const seeded = await api.post(
          "/admin/customers",
          { email, first_name: "Original", last_name: "Owner" },
          adminHeaders
        )
        expect(seeded.status).toBe(200)

        const res = await api.post(
          "/partners/customers",
          { email, first_name: "Typed", last_name: "ByPartner" },
          { headers: partner.headers }
        )

        // 200 and `adopted`, not 201 — the honest description is "you acquired
        // an existing record", not "you created a customer".
        expect(res.status).toBe(200)
        expect(res.data.adopted).toBe(true)
        expect(res.data.customer.id).toBe(seeded.data.customer.id)

        // 🔑 The partner's typed fields are NOT written onto another store's
        // profile. Overwriting them would be a silent cross-tenant edit.
        expect(res.data.customer.first_name).toBe("Original")

        // And they really are this store's customer now — adoption is a link,
        // not a label.
        const listed = await api.get("/partners/customers", {
          headers: partner.headers,
        })
        expect(
          (listed.data.customers as any[]).some(
            (c) => c.id === seeded.data.customer.id
          )
        ).toBe(true)
      })

      it("answers cleanly when the buyer is already this store's customer", async () => {
        const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
        const email = `mine-${unique}@example.com`

        const first = await api.post(
          "/partners/customers",
          { email, first_name: "Mine" },
          { headers: partner.headers }
        )
        expect(first.status).toBe(201)

        const second = await api.post(
          "/partners/customers",
          { email, first_name: "Mine" },
          { headers: partner.headers }
        )

        // Not a 400, and not a duplicate row.
        expect(second.status).toBe(200)
        expect(second.data.already_in_store).toBe(true)
        expect(second.data.adopted).toBe(false)
        expect(second.data.customer.id).toBe(first.data.customer.id)
      })

      it("names the missing field rather than letting core refuse obscurely", async () => {
        const err = await api
          .post("/partners/customers", { first_name: "No Email" }, {
            headers: partner.headers,
          })
          .catch((e: any) => e.response)

        expect(err.status).toBe(400)
        expect(String(err.data.message)).toContain("email")
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

    // #484 — partner UI search was silently dropped: the list route never
    // read `q`, so searching returned the full list. These assert the
    // backend now honors q (by name/email) + offset/limit pagination.
    describe("GET /partners/customers?q= (search + pagination)", () => {
      beforeEach(async () => {
        const unique = Date.now()
        await api.post(
          "/partners/customers",
          { first_name: "Aurora", last_name: "Borealis", email: `aurora-${unique}@example.com` },
          { headers: partner.headers }
        )
        await api.post(
          "/partners/customers",
          { first_name: "Zephyr", last_name: "Quill", email: `zephyr-${unique}@example.com` },
          { headers: partner.headers }
        )
      })

      it("filters by name (q)", async () => {
        const res = await api.get("/partners/customers?q=Aurora", { headers: partner.headers })
        expect(res.status).toBe(200)
        expect(res.data.customers.length).toBeGreaterThanOrEqual(1)
        expect(
          res.data.customers.every((c: any) =>
            `${c.first_name} ${c.last_name} ${c.email}`.toLowerCase().includes("aurora")
          )
        ).toBe(true)
        expect(res.data.count).toBe(res.data.customers.length)
      })

      it("filters by email fragment (q)", async () => {
        const res = await api.get("/partners/customers?q=zephyr-", { headers: partner.headers })
        expect(res.status).toBe(200)
        expect(res.data.customers.length).toBeGreaterThanOrEqual(1)
        expect(
          res.data.customers.every((c: any) => c.email.toLowerCase().includes("zephyr-"))
        ).toBe(true)
      })

      it("returns empty for a non-matching q (search no longer ignored)", async () => {
        const res = await api.get("/partners/customers?q=nonexistent-zzz-needle", {
          headers: partner.headers,
        })
        expect(res.status).toBe(200)
        expect(res.data.customers.length).toBe(0)
        expect(res.data.count).toBe(0)
      })

      it("honors limit/offset pagination", async () => {
        const page = await api.get("/partners/customers?limit=1&offset=0", {
          headers: partner.headers,
        })
        expect(page.status).toBe(200)
        expect(page.data.customers.length).toBe(1)
        expect(page.data.limit).toBe(1)
        expect(page.data.offset).toBe(0)
        // count reflects the full matched set, not the page size
        expect(page.data.count).toBeGreaterThanOrEqual(2)
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
