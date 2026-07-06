import { Modules } from "@medusajs/utils"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import { createTestCustomer } from "../../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../../helpers/setup-checkout-infrastructure"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"

jest.setTimeout(120000)

const UCP_HEADERS = {
  "Content-Type": "application/json",
  "UCP-Agent": "profile=\"https://agent.example/profile\"",
  "Request-Id": "test-req-001",
}

setupSharedTestSuite(() => {
  describe("UCP (Universal Commerce Protocol) endpoints", () => {
    const { api, getContainer } = getSharedTestEnv()

    let publishableKey: string
    let adminHeaders: Record<string, any>
    let regionId: string
    let variantId: string
    let productId: string
    let salesChannelId: string

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
      const { apiKey } = await createTestCustomer(container)
      publishableKey = apiKey.token

      // Create a US/USD region
      const region = await api.post(
        "/admin/regions",
        { name: "US", currency_code: "usd", countries: ["us"] },
        adminHeaders
      )
      regionId = region.data.region.id

      // Set up fulfillment + payment infrastructure
      const infra = await setupCheckoutInfrastructure(container, regionId)

      // Link stock location to the default sales channel
      const storeService: any = container.resolve(Modules.STORE)
      const store = (await storeService.listStores({}))?.[0]
      salesChannelId = store?.default_sales_channel_id

      try {
        const remoteLink: any = container.resolve("link")
        await remoteLink.create({
          [Modules.SALES_CHANNEL]: { sales_channel_id: salesChannelId },
          [Modules.STOCK_LOCATION]: { stock_location_id: infra.stockLocation.id },
        })
      } catch {
        // link may already exist
      }

      // Create a published product with one variant
      const product = await api.post(
        "/admin/products",
        {
          title: `UCP Test Product ${Date.now()}`,
          status: "published",
          sales_channels: [{ id: salesChannelId }],
          options: [{ title: "Size", values: ["M"] }],
          variants: [
            {
              title: "M",
              options: { Size: "M" },
              prices: [{ amount: 499, currency_code: "usd" }],
              manage_inventory: false,
            },
          ],
        },
        adminHeaders
      )
      productId = product.data.product.id
      variantId = product.data.product.variants[0].id
    })

    const ucpHeaders = () => ({
      headers: {
        ...UCP_HEADERS,
        "x-publishable-api-key": publishableKey,
      },
    })

    // =====================================================
    // Discovery
    // =====================================================

    describe("GET /.well-known/ucp", () => {
      it("returns the UCP discovery manifest", async () => {
        const res = await api.get("/.well-known/ucp")

        expect(res.status).toBe(200)
        expect(res.data.ucp).toBeDefined()
        expect(res.data.ucp.version).toBe("2026-04-08")
        expect(res.data.ucp.services["dev.ucp.shopping"]).toBeDefined()
        expect(res.data.ucp.services["dev.ucp.shopping"][0].transport).toBe("rest")
        expect(res.data.ucp.services["dev.ucp.shopping"][0].endpoint).toContain("/ucp")

        expect(res.data.ucp.capabilities["dev.ucp.shopping.checkout"]).toBeDefined()
        expect(res.data.ucp.capabilities["dev.ucp.shopping.cart"]).toBeDefined()
        expect(res.data.ucp.capabilities["dev.ucp.shopping.order"]).toBeDefined()
        expect(res.data.ucp.capabilities["dev.ucp.shopping.fulfillment"]).toBeDefined()

        expect(Array.isArray(res.data.ucp.payment_handlers)).toBe(true)
        const handlerIds = res.data.ucp.payment_handlers.map((h: any) => h.id)
        expect(handlerIds).toContain("payu")
        expect(handlerIds).toContain("stripe")
      })

      it("does not require UCP-Agent or Request-Id headers", async () => {
        const res = await api.get("/.well-known/ucp")
        expect(res.status).toBe(200)
      })
    })

    // =====================================================
    // Header validation
    // =====================================================

    describe("UCP header validation", () => {
      it("rejects POST /ucp/checkout-sessions without UCP-Agent header", async () => {
        let status = 0
        try {
          await api.post("/ucp/checkout-sessions", {
            line_items: [{ item: { id: variantId }, quantity: 1 }],
          }, {
            headers: {
              "Content-Type": "application/json",
              "Request-Id": "test-req-002",
              "x-publishable-api-key": publishableKey,
            },
          })
        } catch (e: any) {
          status = e?.response?.status ?? 0
        }
        expect(status).toBe(400)
      })

      it("accepts requests without a Request-Id header (spec does not mandate it)", async () => {
        // UCP treats Request-Id as correlation, not authorization. When the caller
        // omits it, the server mints one and echoes it back rather than rejecting.
        const res = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          context: { region_id: regionId },
        }, {
          headers: {
            "Content-Type": "application/json",
            "UCP-Agent": "profile=\"https://agent.example/profile\"",
            "x-publishable-api-key": publishableKey,
          },
        })
        expect(res.status).toBe(201)
        expect(res.headers["request-id"]).toBeDefined()
      })
    })

    // =====================================================
    // Checkout Sessions — Create
    // =====================================================

    describe("POST /ucp/checkout-sessions", () => {
      it("creates a checkout session with line items", async () => {
        const res = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 2 }],
          buyer: { email: "ucp-test@example.com", first_name: "UCP", last_name: "Test" },
          context: { region_id: regionId },
        }, ucpHeaders())

        expect(res.status).toBe(201)
        expect(res.data.id).toBeDefined()
        expect(res.data.ucp).toBeDefined()
        expect(res.data.ucp.version).toBe("2026-04-08")
        expect(res.data.status).toBe("incomplete")
        expect(res.data.line_items).toHaveLength(1)
        expect(res.data.line_items[0].quantity).toBe(2)
        expect(res.data.line_items[0].item.id).toBe(variantId)
        expect(res.data.buyer.email).toBe("ucp-test@example.com")
        expect(res.data.totals).toBeDefined()
        const totalTypes = res.data.totals.map((t: any) => t.type)
        expect(totalTypes).toContain("subtotal")
        expect(totalTypes).toContain("total")
      })

      it("creates a checkout session with shipping address", async () => {
        const res = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          buyer: { email: "ucp-addr@example.com" },
          shipping_address: {
            first_name: "John",
            last_name: "Doe",
            street_address: "123 Test St",
            address_locality: "New York",
            address_region: "NY",
            address_country: "us",
            postal_code: "10001",
            phone_number: "+12125551234",
          },
        }, ucpHeaders())

        expect(res.status).toBe(201)
        expect(res.data.shipping_address).toBeDefined()
        expect(res.data.shipping_address.street_address).toBe("123 Test St")
        expect(res.data.shipping_address.address_country).toBe("us")
      })

      it("rejects empty line_items", async () => {
        let status = 0
        try {
          await api.post("/ucp/checkout-sessions", {
            line_items: [],
          }, ucpHeaders())
        } catch (e: any) {
          status = e?.response?.status ?? 0
        }
        expect([400, 422]).toContain(status)
      })
    })

    // =====================================================
    // Checkout Sessions — Retrieve
    // =====================================================

    describe("GET /ucp/checkout-sessions/:id", () => {
      it("retrieves a checkout session by id", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          buyer: { email: "ucp-get@example.com" },
          context: { region_id: regionId },
        }, ucpHeaders())

        const id = create.data.id

        const res = await api.get(`/ucp/checkout-sessions/${id}`, ucpHeaders())

        expect(res.status).toBe(200)
        expect(res.data.id).toBe(id)
        expect(res.data.line_items).toHaveLength(1)
      })

      it("returns 404 for non-existent session", async () => {
        let status = 0
        try {
          await api.get("/ucp/checkout-sessions/cart_nonexistent", ucpHeaders())
        } catch (e: any) {
          status = e?.response?.status ?? 0
        }
        expect(status).toBe(404)
      })
    })

    // =====================================================
    // Checkout Sessions — Update
    // =====================================================

    describe("PUT /ucp/checkout-sessions/:id", () => {
      it("updates buyer email on an existing session", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          context: { region_id: regionId },
        }, ucpHeaders())

        const id = create.data.id

        const res = await api.put(`/ucp/checkout-sessions/${id}`, {
          buyer: { email: "updated@example.com" },
        }, ucpHeaders())

        expect(res.status).toBe(200)
        expect(res.data.buyer.email).toBe("updated@example.com")
      })

      it("adds a shipping address via PUT", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          buyer: { email: "ucp-put@example.com" },
          context: { region_id: regionId },
        }, ucpHeaders())

        const id = create.data.id

        const res = await api.put(`/ucp/checkout-sessions/${id}`, {
          shipping_address: {
            first_name: "Jane",
            last_name: "Doe",
            street_address: "456 Oak Ave",
            address_locality: "New York",
            address_region: "NY",
            address_country: "us",
            postal_code: "10001",
          },
        }, ucpHeaders())

        expect(res.status).toBe(200)
        expect(res.data.shipping_address).toBeDefined()
        expect(res.data.shipping_address.street_address).toBe("456 Oak Ave")
        expect(res.data.shipping_address.address_locality).toBe("New York")
      })

      it("updates line item quantity", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          buyer: { email: "ucp-qty@example.com" },
          context: { region_id: regionId },
        }, ucpHeaders())

        const id = create.data.id
        const lineItemId = create.data.line_items[0].id

        const res = await api.put(`/ucp/checkout-sessions/${id}`, {
          line_items: [{ line_item_id: lineItemId, quantity: 5 }],
        }, ucpHeaders())

        expect(res.status).toBe(200)
        expect(res.data.line_items[0].quantity).toBe(5)
      })
    })

    // =====================================================
    // Checkout Sessions — Complete (validation only)
    // =====================================================

    describe("POST /ucp/checkout-sessions/:id/complete", () => {
      it("rejects completion when email is missing", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          context: { region_id: regionId },
        }, ucpHeaders())

        const id = create.data.id

        let status = 0
        let errorData: any
        try {
          await api.post(`/ucp/checkout-sessions/${id}/complete`, {
            payment: { instruments: [] },
          }, ucpHeaders())
        } catch (e: any) {
          status = e?.response?.status ?? 0
          errorData = e?.response?.data
        }
        expect(status).toBe(400)
        expect(errorData?.ucp?.status).toBe("error")
        expect(errorData?.messages?.[0]?.code).toBe("missing_email")
      })

      it("rejects completion when shipping address is missing", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          buyer: { email: "ucp-no-addr@example.com" },
          context: { region_id: regionId },
        }, ucpHeaders())

        const id = create.data.id

        let status = 0
        try {
          await api.post(`/ucp/checkout-sessions/${id}/complete`, {
            payment: { instruments: [] },
          }, ucpHeaders())
        } catch (e: any) {
          status = e?.response?.status ?? 0
        }
        expect(status).toBe(400)
      })
    })

    // =====================================================
    // Catalog — Search
    // =====================================================

    describe("POST /ucp/catalog/search", () => {
      it("searches the storefront catalog", async () => {
        const res = await api.post("/ucp/catalog/search", {
          query: "UCP",
          pagination: { limit: 5, offset: 0 },
        }, ucpHeaders())

        expect(res.status).toBe(200)
        expect(res.data.ucp).toBeDefined()
        expect(Array.isArray(res.data.products)).toBe(true)
        expect(typeof res.data.count).toBe("number")
      })

      it("returns products with UCP-formatted fields", async () => {
        const res = await api.post("/ucp/catalog/search", {
          pagination: { limit: 10 },
        }, ucpHeaders())

        expect(res.status).toBe(200)
        expect(res.data.products.length).toBeGreaterThan(0)
        const p = res.data.products[0]
        expect(p.id).toBeDefined()
        expect(p.title).toBeDefined()
        expect(p.handle).toBeDefined()
        expect(Array.isArray(p.variants)).toBe(true)
        // Spec: description is a Description object, categories are {value} objects.
        expect(typeof p.description).toBe("object")
        expect(p.description.plain).toBeDefined()
        expect(Array.isArray(p.categories)).toBe(true)
        // Spec: pagination envelope.
        expect(typeof res.data.pagination?.has_next_page).toBe("boolean")
      })
    })

    // =====================================================
    // Catalog — Lookup
    // =====================================================

    describe("POST /ucp/catalog/lookup", () => {
      it("looks up a product by id", async () => {
        const res = await api.post("/ucp/catalog/lookup", {
          ids: [productId],
        }, ucpHeaders())

        expect(res.status).toBe(200)
        expect(res.data.products).toHaveLength(1)
        expect(res.data.products[0].id).toBe(productId)
      })

      it("prices in minor units, uppercase currency, with a region context", async () => {
        // Seeded product is USD 499 (major). UCP wants integer minor units → 49900.
        const res = await api.post("/ucp/catalog/lookup", {
          ids: [productId],
          context: { region_id: regionId },
        }, ucpHeaders())

        expect(res.status).toBe(200)
        const v = res.data.products[0].variants[0]
        expect(v.price).toEqual({ amount: 49900, currency: "USD" })
        expect(v.description.plain).toBeDefined()
        expect(res.data.products[0].price_range.min.currency).toBe("USD")
      })

      it("exposes every merchant currency with dynamic exponents (USD×100, JPY×1)", async () => {
        // JPY has 0 minor-unit digits, so 500 JPY stays 500 (not ×100) — proves the
        // exponent is resolved per-currency, not hardcoded.
        const product = await api.post(
          "/admin/products",
          {
            title: `UCP MultiCcy ${Date.now()}`,
            status: "published",
            sales_channels: [{ id: salesChannelId }],
            options: [{ title: "Size", values: ["M"] }],
            variants: [
              {
                title: "M",
                options: { Size: "M" },
                prices: [
                  { amount: 499, currency_code: "usd" },
                  { amount: 500, currency_code: "jpy" },
                ],
                manage_inventory: false,
              },
            ],
          },
          adminHeaders
        )

        const res = await api.post("/ucp/catalog/lookup", {
          ids: [product.data.product.id],
        }, ucpHeaders())

        expect(res.status).toBe(200)
        const prices = res.data.products[0].variants[0].prices
        expect(prices).toEqual(
          expect.arrayContaining([
            { amount: 49900, currency: "USD" },
            { amount: 500, currency: "JPY" },
          ])
        )
      })
    })

    // =====================================================
    // Orders
    // =====================================================

    describe("GET /ucp/orders/:id", () => {
      it("returns 404 for non-existent order", async () => {
        let status = 0
        let data: any
        try {
          await api.get("/ucp/orders/order_nonexistent", ucpHeaders())
        } catch (e: any) {
          status = e?.response?.status ?? 0
          data = e?.response?.data
        }
        expect(status).toBe(404)
        expect(data.ucp).toBeDefined()
        expect(data.ucp.status).toBe("error")
      })
    })

    // =====================================================
    // Error format
    // =====================================================

    describe("UCP error format", () => {
      it("returns spec-compliant UCP error envelope on 404", async () => {
        let status = 0
        let data: any
        try {
          await api.get("/ucp/checkout-sessions/cart_nonexistent", ucpHeaders())
        } catch (e: any) {
          status = e?.response?.status ?? 0
          data = e?.response?.data
        }
        expect(status).toBe(404)
        expect(data.ucp).toBeDefined()
        expect(data.ucp.status).toBe("error")
        expect(Array.isArray(data.messages)).toBe(true)
        expect(data.messages[0].type).toBe("error")
        expect(data.messages[0].code).toBe("not_found")
        expect(data.messages[0].severity).toBeDefined()
      })
    })
  })
})
