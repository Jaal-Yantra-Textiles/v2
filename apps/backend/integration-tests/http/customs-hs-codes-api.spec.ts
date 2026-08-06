import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { ProductStatus } from "@medusajs/framework/utils"

/**
 * Bulk HS/HSN customs codes — admin routes and their partner mirrors.
 *
 * These exist because the unit tests around `scanMissingHsCodes` /
 * `partitionAssignmentsByStore` mock `query.graph`, and a mock accepts any
 * filter you hand it. The partner routes shipped scoping products with
 * `filters: { sales_channels: { id } }`, which mikro-orm rejects at runtime
 * ("Trying to query by not existing property Product.sales_channels"), so BOTH
 * partner routes 500'd on every call while the unit suite stayed green. Only a
 * spec that runs the query against a real database can catch that class of bug,
 * so the assertions below deliberately go through HTTP end to end.
 */

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

async function createPartnerWithStoreAndProduct(
  api: any,
  adminHeaders: Record<string, any>
) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-hs-${unique}@medusa-test.com`

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

  await api.post(
    "/partners",
    {
      name: `HSTest ${unique}`,
      handle: `hstest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "HS" },
    },
    { headers }
  )

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
        name: `HSStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `HSChannel ${unique}`, description: "Default" },
      region: {
        name: "Default Region",
        currency_code: currencyCode,
        countries: ["us"],
      },
      location: {
        name: "Warehouse",
        address: {
          address_1: "1 Main St",
          city: "NY",
          postal_code: "10001",
          country_code: "US",
        },
      },
    },
    { headers }
  )

  const storeId = storeRes.data.store.id

  const productRes = await api.post(
    "/partners/products",
    {
      store_id: storeId,
      product: {
        title: `Kala Cotton Shirt ${unique}`,
        description: "Handwoven kala cotton shirt, men's woven.",
        handle: `hs-prod-${unique}`,
        status: ProductStatus.PUBLISHED,
        options: [{ title: "Size", values: ["S", "M"] }],
        variants: [
          {
            title: "Small",
            sku: `HS-S-${unique}`,
            options: { Size: "S" },
            prices: [{ amount: 1000, currency_code: currencyCode }],
          },
        ],
      },
    },
    { headers }
  )

  const product = productRes.data.product

  return {
    headers,
    storeId,
    productId: product?.id as string,
    variantIds: ((product?.variants || []) as any[]).map((v) => v.id),
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Customs HS codes API", () => {
    let adminHeaders: Record<string, any>
    let partner: Awaited<ReturnType<typeof createPartnerWithStoreAndProduct>>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      partner = await createPartnerWithStoreAndProduct(api, adminHeaders)
    })

    it("GET /partners/stores/:id/customs/hs-codes/missing scopes to the store's channel", async () => {
      const res = await api.get(
        `/partners/stores/${partner.storeId}/customs/hs-codes/missing`,
        { headers: partner.headers }
      )

      expect(res.status).toBe(200)
      expect(res.data.scanned).toBeGreaterThan(0)

      const gap = (res.data.gaps || []).find(
        (g: any) => g.product_id === partner.productId
      )
      expect(gap).toBeDefined()
      // The scan must carry enough context to classify the goods — a caller that
      // only gets ids has nothing to declare a customs code from.
      expect(gap.description).toContain("kala cotton")
      expect(gap.suggested_target).toMatchObject({ id: expect.any(String) })

      // Scoped means scoped: nothing outside this partner's channel may appear.
      const foreign = (res.data.gaps || []).filter(
        (g: any) => g.product_id !== partner.productId
      )
      expect(foreign).toHaveLength(0)
    })

    it("POST /partners/stores/:id/customs/hs-codes fills a gap the scan reported", async () => {
      const scan = await api.get(
        `/partners/stores/${partner.storeId}/customs/hs-codes/missing`,
        { headers: partner.headers }
      )
      const target = (scan.data.gaps || []).find(
        (g: any) => g.product_id === partner.productId
      ).suggested_target

      const apply = await api.post(
        `/partners/stores/${partner.storeId}/customs/hs-codes`,
        {
          assignments: [
            { level: target.level, id: target.id, hs_code: "62052000" },
          ],
        },
        { headers: partner.headers }
      )

      expect(apply.status).toBe(200)
      expect(apply.data.applied).toBe(1)
      expect(apply.data.errors).toBe(0)

      // A written code must make the item disappear from the scan — the two
      // halves resolve through the same chain, so a level that "applies" but
      // stays missing means the write landed somewhere a label can't read.
      const rescan = await api.get(
        `/partners/stores/${partner.storeId}/customs/hs-codes/missing`,
        { headers: partner.headers }
      )
      expect(
        (rescan.data.gaps || []).find((g: any) => g.product_id === partner.productId)
      ).toBeUndefined()
    })

    it("rejects an id outside the store's catalogue without failing the batch", async () => {
      const scan = await api.get(
        `/partners/stores/${partner.storeId}/customs/hs-codes/missing`,
        { headers: partner.headers }
      )
      const target = (scan.data.gaps || []).find(
        (g: any) => g.product_id === partner.productId
      ).suggested_target

      const res = await api.post(
        `/partners/stores/${partner.storeId}/customs/hs-codes`,
        {
          assignments: [
            { level: target.level, id: target.id, hs_code: "62052000" },
            { level: "product", id: "prod_not_mine", hs_code: "62052000" },
          ],
        },
        { headers: partner.headers }
      )

      expect(res.status).toBe(200)
      expect(res.data.applied).toBe(1)
      expect(res.data.errors).toBe(1)
      expect(
        res.data.results.find((r: any) => r.id === "prod_not_mine").reason
      ).toMatch(/not part of your store's catalogue/i)
    })

    it("GET /admin/customs/hs-codes/missing scans unscoped and paginates", async () => {
      const res = await api.get(
        "/admin/customs/hs-codes/missing?limit=5",
        adminHeaders
      )

      expect(res.status).toBe(200)
      expect(res.data.limit).toBe(5)
      expect(Array.isArray(res.data.gaps)).toBe(true)
    })

    it("POST /admin/customs/hs-codes writes at the level it is told to", async () => {
      const res = await api.post(
        "/admin/customs/hs-codes",
        {
          assignments: [
            {
              level: "variant",
              id: partner.variantIds[0],
              hs_code: "62052000",
              origin_country: "IN",
            },
            { level: "variant", id: "variant_nope", hs_code: "62052000" },
          ],
        },
        adminHeaders
      )

      // Per-row outcomes, not an all-or-nothing status: a bad id in a big batch
      // must not discard the good writes.
      expect(res.status).toBe(200)
      expect(res.data.applied).toBe(1)
      expect(res.data.errors).toBe(1)
    })
  })
})
