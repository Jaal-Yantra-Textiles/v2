import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { shiprocketStubState } from "../../src/modules/shipping-providers/shiprocket/stub-fetch"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

/**
 * #1111 S1 — a retail/core order shipping to a NON-India destination generates a
 * real Shiprocket shipment via the international API namespace
 * (`/international/orders/create/adhoc` → serviceability → assign/awb), with a
 * customs-declaration body (country NAME, currency, export reason, HSN).
 *
 * Mirrors partner-order-shiprocket-label.spec.ts (#772) but with a US buyer, so
 * the client's destination-country routing kicks in. HSN rides on the line-item
 * metadata (the interim source until product hs_code is wired in S2).
 *
 * `SHIPROCKET_STUB=1` injects the deterministic transport; its international
 * branch captures the create body into `shiprocketStubState.lastIntlAdhocBody`.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /partners/orders/:id/shiprocket-label — international (#1111)", () => {
    let adminHeaders: any
    let partnerHeaders: any
    let locationId: string
    let salesChannelId: string
    let regionId: string
    let orderId: string

    let prevEmail: string | undefined
    let prevPassword: string | undefined
    let prevStub: string | undefined

    beforeAll(() => {
      prevEmail = process.env.SHIPROCKET_EMAIL
      prevPassword = process.env.SHIPROCKET_PASSWORD
      prevStub = process.env.SHIPROCKET_STUB
      process.env.SHIPROCKET_EMAIL = "test@shiprocket.example"
      process.env.SHIPROCKET_PASSWORD = "secret"
      process.env.SHIPROCKET_STUB = "1"
    })

    afterAll(() => {
      if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL
      else process.env.SHIPROCKET_EMAIL = prevEmail
      if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD
      else process.env.SHIPROCKET_PASSWORD = prevPassword
      if (prevStub === undefined) delete process.env.SHIPROCKET_STUB
      else process.env.SHIPROCKET_STUB = prevStub
    })

    beforeEach(async () => {
      shiprocketStubState.lastAdhocBody = undefined
      shiprocketStubState.lastIntlAdhocBody = undefined
      shiprocketStubState.lastAddPickupBody = undefined

      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const email = `intl-${unique}@t.com`
      await api.post("/auth/partner/emailpass/register", {
        email,
        password: PARTNER_PASSWORD,
      })
      const login1 = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      let headers: any = { Authorization: `Bearer ${login1.data.token}` }
      await api.post(
        "/partners",
        {
          name: `Intl ${unique}`,
          handle: `intl-${unique}`,
          admin: { email, first_name: "I", last_name: unique },
        },
        { headers }
      )
      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      await api
        .post(
          "/admin/shipping-profiles",
          { name: `default-${unique}`, type: "default" },
          adminHeaders
        )
        .catch(() => {})

      const storeRes = await api.post(
        "/partners/stores",
        {
          store: {
            name: `IStore ${unique}`,
            supported_currencies: [{ currency_code: "usd", is_default: true }],
          },
          sales_channel: { name: `IChannel ${unique}`, description: "Default" },
          region: {
            name: `I Region ${unique}`,
            currency_code: "usd",
            countries: ["us"],
          },
          // Ship-FROM is an India address (export origin). Phone is added below
          // via admin (the /partners/stores location schema rejects `phone`).
          location: {
            name: "I Warehouse",
            address: {
              address_1: "1 Loom St",
              city: "Surendranagar",
              province: "GJ",
              postal_code: "363035",
              country_code: "IN",
            },
          },
        },
        { headers: partnerHeaders }
      )
      locationId = storeRes.data.location?.id
      salesChannelId = storeRes.data.sales_channel?.id
      regionId = storeRes.data.region?.id
      expect(locationId).toBeTruthy()

      // Give the ship-from a phone so it is registerable as a Shiprocket pickup.
      await api.post(
        `/admin/stock-locations/${locationId}`,
        {
          address: {
            address_1: "1 Loom St",
            city: "Surendranagar",
            province: "GJ",
            postal_code: "363035",
            country_code: "IN",
            phone: "9990001112",
          },
        },
        adminHeaders
      )

      const locDetail = await api.get(
        `/admin/stock-locations/${locationId}?fields=id,*fulfillment_sets.service_zones`,
        adminHeaders
      )
      const zoneId = (locDetail.data.stock_location?.fulfillment_sets || [])
        .flatMap((f: any) => f.service_zones || [])
        .map((z: any) => z.id)
        .find(Boolean)
      expect(zoneId).toBeTruthy()
      const profiles = await api.get("/admin/shipping-profiles?limit=1", adminHeaders)
      const profileId = profiles.data.shipping_profiles?.[0]?.id
      expect(profileId).toBeTruthy()
      await api.post(
        "/admin/shipping-options",
        {
          name: "Standard Shipping",
          service_zone_id: zoneId,
          shipping_profile_id: profileId,
          provider_id: "manual_manual",
          price_type: "flat",
          type: { label: "Standard", description: "Std", code: "standard" },
          prices: [{ currency_code: "usd", amount: 10 }],
        },
        adminHeaders
      )

      // US buyer → international. HSN carried on the line-item metadata.
      const draft = await api.post(
        "/admin/draft-orders",
        {
          email: "buyer@t.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          shipping_address: {
            first_name: "Elena",
            last_name: "Doe",
            address_1: "9 Buyer Rd",
            city: "Dallas",
            province: "TX",
            postal_code: "75201",
            country_code: "us",
            phone: "8887776665",
          },
          items: [
            {
              title: "Tangaliya Stole",
              quantity: 1,
              unit_price: 1500,
              metadata: { hsn: "621410" },
            },
          ],
        },
        adminHeaders
      )
      const draftId = draft.data.draft_order?.id
      const converted = await api.post(
        `/admin/draft-orders/${draftId}/convert-to-order`,
        {},
        adminHeaders
      )
      orderId = converted.data.order?.id ?? draftId
    })

    it("ships a US order via the international API with a customs body", async () => {
      const res = await api.post(
        `/partners/orders/${orderId}/shiprocket-label`,
        {},
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.shiprocket_label.awb).toBe("STUBAWB123")
      // provider_refs flag the international path.
      expect(res.data.shiprocket_label.provider_refs?.international).toBe(true)

      // The international create/adhoc endpoint was hit (captured separately).
      const body = shiprocketStubState.lastIntlAdhocBody
      expect(body).toBeTruthy()
      // Country as a NAME (not ISO), amounts in the order currency, commercial export.
      expect(body.billing_country).toBe("United States")
      expect(body.currency).toBe("USD")
      expect(body.payment_method).toBe("Prepaid")
      expect(body.reasonOfExport).toBe(3)
      expect(body.purpose_of_shipment).toBe(2)
      expect(body.Terms_Of_Invoice).toBe("FOB")
      expect(body.igstPaymentStatus).toBe("A")
      expect(body.commodity).toBe(true)
      // HSN reached the line item.
      expect(body.order_items[0].hsn).toBe("621410")
      // Ships from the partner's registered India pickup.
      const nickname = `warehouse-${locationId.slice(-8)}`
      expect(body.pickup_location).toBe(nickname)
    })

    it("rejects the international shipment when a line has no HSN code", async () => {
      // Create a second order whose item carries NO hsn.
      const draft = await api.post(
        "/admin/draft-orders",
        {
          email: "buyer2@t.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          shipping_address: {
            first_name: "No",
            last_name: "Hsn",
            address_1: "9 Buyer Rd",
            city: "Dallas",
            province: "TX",
            postal_code: "75201",
            country_code: "us",
            phone: "8887776665",
          },
          items: [{ title: "Mystery Item", quantity: 1, unit_price: 1500 }],
        },
        adminHeaders
      )
      const converted = await api.post(
        `/admin/draft-orders/${draft.data.draft_order.id}/convert-to-order`,
        {},
        adminHeaders
      )
      const noHsnOrderId = converted.data.order?.id

      const res = await api
        .post(
          `/partners/orders/${noHsnOrderId}/shiprocket-label`,
          {},
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.data.message).toMatch(/HSN code is required/i)
    })
  })
})
