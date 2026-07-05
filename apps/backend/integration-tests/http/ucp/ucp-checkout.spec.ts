import { createTestCustomer } from "../../helpers/create-customer"
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
    let variantId: string

    beforeEach(async () => {
      const { apiKey } = await createTestCustomer(getContainer())
      publishableKey = apiKey.token

      // Fetch a product variant to use in checkout tests
      const res = await api.get("/store/products?fields=id,title,variants.id&limit=1", {
        headers: { "x-publishable-api-key": publishableKey },
      })
      const product = res.data.products?.[0]
      variantId = product?.variants?.[0]?.id
      if (!variantId) {
        throw new Error("No product variant found in test DB for UCP tests")
      }
    })

    // =====================================================
    // Discovery
    // =====================================================

    describe("GET /.well-known/ucp", () => {
      it("returns the UCP discovery manifest", async () => {
        const res = await api.get("/.well-known/ucp")

        expect(res.status).toBe(200)
        expect(res.data.ucp).toBeDefined()
        expect(res.data.ucp.version).toBe("2026-01-11")
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

      it("rejects POST /ucp/checkout-sessions without Request-Id header", async () => {
        let status = 0
        try {
          await api.post("/ucp/checkout-sessions", {
            line_items: [{ item: { id: variantId }, quantity: 1 }],
          }, {
            headers: {
              "Content-Type": "application/json",
              "UCP-Agent": "profile=\"https://agent.example/profile\"",
              "x-publishable-api-key": publishableKey,
            },
          })
        } catch (e: any) {
          status = e?.response?.status ?? 0
        }
        expect(status).toBe(400)
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
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(201)
        expect(res.data.id).toBeDefined()
        expect(res.data.ucp).toBeDefined()
        expect(res.data.ucp.version).toBe("2026-01-11")
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
            address_locality: "Mumbai",
            address_region: "MH",
            address_country: "in",
            postal_code: "400001",
            phone_number: "+919999999999",
          },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(201)
        expect(res.data.shipping_address).toBeDefined()
        expect(res.data.shipping_address.street_address).toBe("123 Test St")
        expect(res.data.shipping_address.address_country).toBe("in")
      })

      it("rejects empty line_items", async () => {
        let status = 0
        try {
          await api.post("/ucp/checkout-sessions", {
            line_items: [],
          }, {
            headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
          })
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
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        const id = create.data.id

        const res = await api.get(`/ucp/checkout-sessions/${id}`, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(200)
        expect(res.data.id).toBe(id)
        expect(res.data.line_items).toHaveLength(1)
      })

      it("returns 404 for non-existent session", async () => {
        let status = 0
        try {
          await api.get("/ucp/checkout-sessions/cart_nonexistent", {
            headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
          })
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
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        const id = create.data.id

        const res = await api.put(`/ucp/checkout-sessions/${id}`, {
          buyer: { email: "updated@example.com" },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(200)
        expect(res.data.buyer.email).toBe("updated@example.com")
      })

      it("adds a shipping address via PUT", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          buyer: { email: "ucp-put@example.com" },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        const id = create.data.id

        const res = await api.put(`/ucp/checkout-sessions/${id}`, {
          shipping_address: {
            first_name: "Jane",
            last_name: "Doe",
            street_address: "456 Oak Ave",
            address_locality: "Delhi",
            address_region: "DL",
            address_country: "in",
            postal_code: "110001",
          },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(200)
        expect(res.data.shipping_address).toBeDefined()
        expect(res.data.shipping_address.street_address).toBe("456 Oak Ave")
        expect(res.data.shipping_address.address_locality).toBe("Delhi")
      })

      it("updates line item quantity", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
          buyer: { email: "ucp-qty@example.com" },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        const id = create.data.id
        const lineItemId = create.data.line_items[0].id

        const res = await api.put(`/ucp/checkout-sessions/${id}`, {
          line_items: [{ line_item_id: lineItemId, quantity: 5 }],
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(200)
        expect(res.data.line_items[0].quantity).toBe(5)
      })
    })

    // =====================================================
    // Checkout Sessions — Complete
    // =====================================================

    describe("POST /ucp/checkout-sessions/:id/complete", () => {
      it("rejects completion when email is missing", async () => {
        const create = await api.post("/ucp/checkout-sessions", {
          line_items: [{ item: { id: variantId }, quantity: 1 }],
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        const id = create.data.id

        let status = 0
        let errorData: any
        try {
          await api.post(`/ucp/checkout-sessions/${id}/complete`, {
            payment: { instruments: [] },
          }, {
            headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
          })
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
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        const id = create.data.id

        let status = 0
        try {
          await api.post(`/ucp/checkout-sessions/${id}/complete`, {
            payment: { instruments: [] },
          }, {
            headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
          })
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
          query: "test",
          pagination: { limit: 5, offset: 0 },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(200)
        expect(res.data.ucp).toBeDefined()
        expect(Array.isArray(res.data.products)).toBe(true)
        expect(typeof res.data.count).toBe("number")
      })

      it("returns products with UCP-formatted fields", async () => {
        const res = await api.post("/ucp/catalog/search", {
          pagination: { limit: 1 },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(200)
        if (res.data.products.length > 0) {
          const p = res.data.products[0]
          expect(p.id).toBeDefined()
          expect(p.title).toBeDefined()
          expect(p.handle).toBeDefined()
          expect(Array.isArray(p.variants)).toBe(true)
        }
      })
    })

    // =====================================================
    // Catalog — Lookup
    // =====================================================

    describe("POST /ucp/catalog/lookup", () => {
      it("looks up a product by id", async () => {
        // First search to get a product id
        const search = await api.post("/ucp/catalog/search", {
          pagination: { limit: 1 },
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        if (search.data.products.length === 0) return

        const productId = search.data.products[0].id

        const res = await api.post("/ucp/catalog/lookup", {
          ids: [productId],
        }, {
          headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
        })

        expect(res.status).toBe(200)
        expect(res.data.products).toHaveLength(1)
        expect(res.data.products[0].id).toBe(productId)
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
          await api.get("/ucp/checkout-sessions/cart_nonexistent", {
            headers: { ...UCP_HEADERS, "x-publishable-api-key": publishableKey },
          })
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
