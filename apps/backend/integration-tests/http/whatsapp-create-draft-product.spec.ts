import { setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { createDraftProductFromExtractionWorkflow } from "../../src/workflows/whatsapp/create-draft-product-from-extraction"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(90 * 1000)

async function bootPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `wa-prod-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
  const login1 = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `WATest ${unique}`,
      handle: `watest-${unique}`,
      admin: { email, first_name: "Admin", last_name: "WA" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id
  const partnerName = partnerRes.data.partner.name

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
        name: `WAStore ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `WAChannel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Main St", city: "NY", postal_code: "10001", country_code: "US" },
      },
    },
    { headers }
  )

  return {
    partnerId,
    partnerName,
    storeId: storeRes.data.store.id,
    salesChannelId: storeRes.data.store.default_sales_channel_id,
    currencyCode,
    headers,
  }
}

describe("createDraftProductFromExtractionWorkflow", () => {
  setupSharedTestSuite(({ api, getContainer }) => {
    let adminHeaders: any

    beforeAll(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("creates a DRAFT product from extracted fields with no media", async () => {
      const partner = await bootPartnerWithStore(api, adminHeaders)
      const container = getContainer()

      const { result } = await createDraftProductFromExtractionWorkflow(container).run({
        input: {
          partner_id: partner.partnerId,
          partner_name: partner.partnerName,
          media_ids: [],
          extracted: {
            title: "Handwoven Cotton Kurta",
            description: "Soft cotton, hand-loom Kashmir.",
            suggested_price: 4500,
            fabric_type: "cotton",
            colors: ["white", "indigo"],
          },
          caption: "Saree silk ₹4500",
        },
      })

      expect(result).toBeDefined()
      expect(result.product_id).toMatch(/^prod_/)
      expect(result.product_title).toBe("Handwoven Cotton Kurta")
      expect(result.status).toBe("draft")
      expect(result.admin_url).toBe(`/app/products/${result.product_id}`)
      expect(result.rehosted_image_urls).toEqual([])

      // Read it back via the partner products route and assert shape.
      const detail = await api.get(
        `/partners/stores/${partner.storeId}/products/${result.product_id}`,
        { headers: partner.headers }
      )
      expect(detail.status).toBe(200)
      const product = detail.data.product
      expect(product.status).toBe("draft")
      expect(product.title).toBe("Handwoven Cotton Kurta")
      expect(product.description).toBe("Soft cotton, hand-loom Kashmir.")
      expect(product.metadata?.created_via).toBe("whatsapp")
      expect(product.metadata?.wa_fabric_type).toBe("cotton")
      expect(product.metadata?.wa_colors).toEqual(["white", "indigo"])

      // Single variant in the store's default currency at the extracted price.
      expect(product.variants?.length).toBe(1)
      const price = (product.variants[0].prices || []).find(
        (p: any) => p.currency_code === partner.currencyCode
      )
      expect(price?.amount).toBe(4500)
    })

    it("defaults missing suggested_price to 0", async () => {
      const partner = await bootPartnerWithStore(api, adminHeaders)
      const container = getContainer()

      const { result } = await createDraftProductFromExtractionWorkflow(container).run({
        input: {
          partner_id: partner.partnerId,
          partner_name: partner.partnerName,
          media_ids: [],
          extracted: {
            title: "Untitled Saree",
            // no suggested_price
          },
        },
      })
      expect(result.product_id).toMatch(/^prod_/)

      const detail = await api.get(
        `/partners/stores/${partner.storeId}/products/${result.product_id}`,
        { headers: partner.headers }
      )
      const price = (detail.data.product.variants[0].prices || []).find(
        (p: any) => p.currency_code === partner.currencyCode
      )
      expect(price?.amount).toBe(0)
    })

    it("fails the workflow when extracted.title is missing", async () => {
      const partner = await bootPartnerWithStore(api, adminHeaders)
      const container = getContainer()

      // Medusa workflows don't throw on step errors — failures land in
      // `errors`. We assert that array contains the expected message
      // and no product was returned.
      const { result, errors } = await createDraftProductFromExtractionWorkflow(container).run({
        input: {
          partner_id: partner.partnerId,
          partner_name: partner.partnerName,
          media_ids: [],
          extracted: {
            // no title
            suggested_price: 1000,
          },
        },
        throwOnError: false,
      })

      expect(errors?.length).toBeGreaterThan(0)
      const msgs = (errors || []).map((e: any) => e?.error?.message || String(e)).join(" | ")
      expect(msgs).toMatch(/title is required/i)
      expect(result).toBeFalsy()
    })

    it("fails the workflow when partner has no store", async () => {
      // Register a partner but don't create a store for them.
      const unique = Date.now() + Math.random().toString(36).slice(2, 6)
      const email = `wa-nostore-${unique}@medusa-test.com`
      await api.post("/auth/partner/emailpass/register", { email, password: TEST_PARTNER_PASSWORD })
      const login = await api.post("/auth/partner/emailpass", { email, password: TEST_PARTNER_PASSWORD })
      const headers = { Authorization: `Bearer ${login.data.token}` }
      const partnerRes = await api.post(
        "/partners",
        {
          name: `NoStorePartner ${unique}`,
          handle: `nostore-${unique}`,
          admin: { email, first_name: "A", last_name: "B" },
        },
        { headers }
      )
      const partnerId = partnerRes.data.partner.id

      const container = getContainer()
      const { result, errors } = await createDraftProductFromExtractionWorkflow(container).run({
        input: {
          partner_id: partnerId,
          partner_name: "NoStorePartner",
          media_ids: [],
          extracted: { title: "x" },
        },
        throwOnError: false,
      })

      expect(errors?.length).toBeGreaterThan(0)
      const msgs = (errors || []).map((e: any) => e?.error?.message || String(e)).join(" | ")
      expect(msgs).toMatch(/no store/i)
      expect(result).toBeFalsy()
    })
  })
})
