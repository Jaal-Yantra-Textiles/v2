import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { assertEnvelopeShape, assertResourceShape } from "./_helpers"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

// Wire-contract parity tests for partner regions vs admin regions.
//
// See apps/docs/notes/PARTNER_API_PARITY.md for the audit register and
// the rule that partner routes must mirror admin's envelope and
// resource shape (partner may add enrichment fields like
// `payment_providers` but never new top-level envelope keys).
//
// These tests assert SHAPE, not VALUES. Admin sees all rows; partner
// sees their scoped subset. As long as both come back with the same
// envelope keys and the partner resource is a superset of admin's
// resource keys, parity holds.

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-parity-regions-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })

  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `ParityTest ${unique}`,
      handle: `paritytest-${unique}`,
      admin: { email, first_name: "Parity", last_name: "Test" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Store ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `Channel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Main Warehouse",
        address: { address_1: "123 Main St", city: "New York", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    currencyCode,
    storeId: storeRes.data.store.id,
    regionId: storeRes.data.region?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner ↔ Admin parity: regions", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStore>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStore(api, adminHeaders)
    })

    describe("GET /regions (list)", () => {
      it("envelope shape matches admin", async () => {
        const adminRes = await api.get("/admin/regions?limit=5", adminHeaders)
        const partnerRes = await api.get(
          `/partners/stores/${partner.storeId}/regions?limit=5`,
          { headers: partner.headers }
        )

        expect(adminRes.status).toBe(200)
        expect(partnerRes.status).toBe(200)
        assertEnvelopeShape(adminRes.data, partnerRes.data, "GET regions list")

        // Resource shape — first region from each. Partner adds
        // `payment_providers` as inlined enrichment, allowed by the
        // contract; admin doesn't include it by default.
        if (adminRes.data.regions[0] && partnerRes.data.regions[0]) {
          assertResourceShape(
            adminRes.data.regions[0],
            partnerRes.data.regions[0],
            { context: "regions list item" }
          )
        }
      })

      it("respects pagination params identically", async () => {
        const adminRes = await api.get("/admin/regions?limit=2&offset=0", adminHeaders)
        const partnerRes = await api.get(
          `/partners/stores/${partner.storeId}/regions?limit=2&offset=0`,
          { headers: partner.headers }
        )

        expect(adminRes.data.limit).toBe(2)
        expect(partnerRes.data.limit).toBe(2)
        expect(adminRes.data.offset).toBe(0)
        expect(partnerRes.data.offset).toBe(0)
      })
    })

    describe("POST /regions (create)", () => {
      it("envelope shape matches admin", async () => {
        const body = {
          name: "Parity Test Region",
          currency_code: partner.currencyCode,
          countries: ["ca"],
        }

        const adminRes = await api.post("/admin/regions", body, adminHeaders)
        const partnerRes = await api.post(
          `/partners/stores/${partner.storeId}/regions`,
          { ...body, countries: ["gb"] }, // different country to avoid FK conflict
          { headers: partner.headers }
        )

        expect(adminRes.status).toBe(200)
        expect(partnerRes.status).toBe(201) // partner uses 201; admin uses 200
        assertEnvelopeShape(adminRes.data, partnerRes.data, "POST regions create")
        assertResourceShape(adminRes.data.region, partnerRes.data.region, {
          context: "created region",
        })
      })
    })

    describe("GET /regions/:id (single)", () => {
      it("envelope shape matches admin", async () => {
        const adminRes = await api.get(`/admin/regions/${partner.regionId}`, adminHeaders)
        const partnerRes = await api.get(
          `/partners/stores/${partner.storeId}/regions/${partner.regionId}`,
          { headers: partner.headers }
        )

        expect(adminRes.status).toBe(200)
        expect(partnerRes.status).toBe(200)
        assertEnvelopeShape(adminRes.data, partnerRes.data, "GET regions single")
        assertResourceShape(adminRes.data.region, partnerRes.data.region, {
          context: "single region",
        })
      })
    })

    describe("POST /regions/:id (update)", () => {
      it("envelope shape matches admin", async () => {
        const update = { name: "Renamed Region" }

        const adminRes = await api.post(
          `/admin/regions/${partner.regionId}`,
          update,
          adminHeaders
        )
        const partnerRes = await api.post(
          `/partners/stores/${partner.storeId}/regions/${partner.regionId}`,
          update,
          { headers: partner.headers }
        )

        expect(adminRes.status).toBe(200)
        expect(partnerRes.status).toBe(200)
        assertEnvelopeShape(adminRes.data, partnerRes.data, "POST regions update")
      })
    })

    describe("DELETE /regions/:id", () => {
      it("envelope shape matches admin", async () => {
        // Use two separate freshly-created regions so each delete is the
        // sole-owner case (ref-counted delete deletes the row). Sharing
        // is covered in the per-partner behavior suite.
        const adminCreated = await api.post(
          "/admin/regions",
          { name: "To Delete (admin)", currency_code: partner.currencyCode, countries: ["br"] },
          adminHeaders
        )
        const partnerCreated = await api.post(
          `/partners/stores/${partner.storeId}/regions`,
          { name: "To Delete (partner)", currency_code: partner.currencyCode, countries: ["mx"] },
          { headers: partner.headers }
        )

        const adminRes = await api.delete(
          `/admin/regions/${adminCreated.data.region.id}`,
          adminHeaders
        )
        const partnerRes = await api.delete(
          `/partners/stores/${partner.storeId}/regions/${partnerCreated.data.region.id}`,
          { headers: partner.headers }
        )

        expect(adminRes.status).toBe(200)
        expect(partnerRes.status).toBe(200)
        assertEnvelopeShape(adminRes.data, partnerRes.data, "DELETE region")
        expect(adminRes.data.object).toBe("region")
        expect(partnerRes.data.object).toBe("region")
        expect(adminRes.data.deleted).toBe(true)
        expect(partnerRes.data.deleted).toBe(true)
      })
    })

    describe("GET /payment-providers (discovery)", () => {
      it("envelope shape matches admin", async () => {
        const adminRes = await api.get("/admin/payments/payment-providers", adminHeaders)
        const partnerRes = await api.get(
          `/partners/stores/${partner.storeId}/payment-providers`,
          { headers: partner.headers }
        )

        expect(adminRes.status).toBe(200)
        expect(partnerRes.status).toBe(200)
        assertEnvelopeShape(adminRes.data, partnerRes.data, "GET payment-providers")
        if (adminRes.data.payment_providers[0] && partnerRes.data.payment_providers[0]) {
          assertResourceShape(
            adminRes.data.payment_providers[0],
            partnerRes.data.payment_providers[0],
            { context: "payment_provider" }
          )
        }
      })
    })
  })
})
