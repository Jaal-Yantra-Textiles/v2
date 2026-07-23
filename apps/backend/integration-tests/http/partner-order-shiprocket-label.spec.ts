import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { shiprocketStubState } from "../../src/modules/shipping-providers/shiprocket/stub-fetch"

const PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

/**
 * #772 (core-order half) — `POST /partners/orders/:id/shiprocket-label` must
 * ship from the PARTNER'S OWN stock location (the one linked to their default
 * sales channel), never from `resolvePlainFulfillmentContext`'s arbitrary
 * manual-option location or the shared account's first registered pickup
 * (the #638 fallback, which on the shared Shiprocket account is some OTHER
 * party's warehouse).
 *
 * The order is created admin-side as a draft in the partner's sales channel
 * and converted — retail ownership (`validatePartnerOrderOwnership`) is by
 * sales-channel match, so no store checkout flow is needed.
 *
 * NOTE (local runs): the repo `.env` sets PARTNER_EMAIL_VERIFICATION=true,
 * which makes partner logins return an actorless token. Run locally with
 * PARTNER_EMAIL_VERIFICATION=false (CI leaves it unset).
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /partners/orders/:id/shiprocket-label — partner ship-from (#772 core)", () => {
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
      shiprocketStubState.lastAddPickupBody = undefined

      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      // Partner + store (default sales channel + linked stock location).
      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      const email = `label-${unique}@t.com`
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
          name: `Label ${unique}`,
          handle: `label-${unique}`,
          admin: { email, first_name: "L", last_name: unique },
        },
        { headers }
      )
      const login2 = await api.post("/auth/partner/emailpass", {
        email,
        password: PARTNER_PASSWORD,
      })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      // The store-defaults workflow only creates its (manual) shipping options
      // when a shipping profile exists — resolvePlainFulfillmentContext needs
      // one of those manual options to create the plain fulfillment.
      await api
        .post(
          "/admin/shipping-profiles",
          { name: `default-${unique}`, type: "default" },
          adminHeaders
        )
        .catch(() => {
          /* one may already exist — listShippingProfiles takes any */
        })

      // US region → the manual_manual provider path (IN maps to Delhivery
      // calculated options, which aren't "manual" and can't back the plain
      // fulfillment). The ship-FROM location stays an IN address — that's the
      // half under test.
      const storeRes = await api.post(
        "/partners/stores",
        {
          store: {
            name: `LStore ${unique}`,
            supported_currencies: [
              { currency_code: "usd", is_default: true },
            ],
          },
          sales_channel: { name: `LChannel ${unique}`, description: "Default" },
          region: {
            name: `L Region ${unique}`,
            currency_code: "usd",
            countries: ["us"],
          },
          location: {
            // No phone on purpose — individual tests add address/metadata to
            // exercise register vs pre-registered vs unregisterable paths.
            name: "L Warehouse",
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

      // The store-defaults workflow's own option creation is best-effort and
      // silently skips in the bare test env — create the manual option the
      // plain fulfillment needs directly against the location's service zone.
      const locDetail = await api.get(
        `/admin/stock-locations/${locationId}?fields=id,*fulfillment_sets.service_zones`,
        adminHeaders
      )
      const fusets = locDetail.data.stock_location?.fulfillment_sets || []
      const zoneId = fusets
        .flatMap((f: any) => f.service_zones || [])
        .map((z: any) => z.id)
        .find(Boolean)
      expect(zoneId).toBeTruthy()
      const profiles = await api.get(
        "/admin/shipping-profiles?limit=1",
        adminHeaders
      )
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

      // Order in the partner's channel: admin draft → convert (retail
      // ownership is by sales-channel match — no checkout needed).
      const draft = await api.post(
        "/admin/draft-orders",
        {
          email: "customer@t.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          // Destination is incidental to this suite (it tests pickup ship-from);
          // keep it an India address so it stays on the DOMESTIC Shiprocket path.
          // International (non-IN) routing is covered in
          // retail-order-international-shiprocket.spec.ts (#1111).
          shipping_address: {
            first_name: "Cust",
            last_name: "Omer",
            address_1: "9 Buyer Rd",
            city: "Mumbai",
            province: "MH",
            postal_code: "400001",
            country_code: "in",
            phone: "8887776665",
          },
          items: [{ title: "Tangaliya Stole", quantity: 1, unit_price: 1500 }],
        },
        adminHeaders
      )
      const draftId = draft.data.draft_order.id
      const converted = await api.post(
        `/admin/draft-orders/${draftId}/convert-to-order`,
        {},
        adminHeaders
      )
      orderId = converted.data.order?.id ?? draftId
    })

    it("registers the partner's channel-linked location as the pickup — not the shared account's first pickup", async () => {
      // Give the location a registerable address (phone). The old code fell
      // back to chooseRegisteredPickup → "warehouse-primary" (another party's
      // warehouse on the shared account).
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

      const res = await api.post(
        `/partners/orders/${orderId}/shiprocket-label`,
        {},
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.shiprocket_label.awb).toBe("STUBAWB123")

      // The partner's location was registered as the pickup…
      const nickname = `warehouse-${locationId.slice(-8)}`
      expect(shiprocketStubState.lastAddPickupBody).toBeTruthy()
      expect(shiprocketStubState.lastAddPickupBody.pickup_location).toBe(
        nickname
      )
      expect(shiprocketStubState.lastAddPickupBody.pin_code).toBe("363035")
      // …and the shipment originates THERE, not at warehouse-primary.
      expect(shiprocketStubState.lastAdhocBody.pickup_location).toBe(nickname)

      // The fulfillment records the partner's location as ship-from.
      const query: any = getContainer().resolve("query")
      const { data: orders } = await query.graph({
        entity: "order",
        fields: ["fulfillments.location_id"],
        filters: { id: orderId },
      })
      expect(orders?.[0]?.fulfillments?.[0]?.location_id).toBe(locationId)
    })

    it("uses a pre-recorded pickup nickname as-is (no re-registration)", async () => {
      await api.post(
        `/admin/stock-locations/${locationId}`,
        { metadata: { shiprocket_pickup_location: "warehouse-primary" } },
        adminHeaders
      )

      const res = await api.post(
        `/partners/orders/${orderId}/shiprocket-label`,
        {},
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(200)
      expect(shiprocketStubState.lastAddPickupBody).toBeUndefined()
      expect(shiprocketStubState.lastAdhocBody.pickup_location).toBe(
        "warehouse-primary"
      )
    })

    it("accepts carrier in the request body (carrier-neutral)", async () => {
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

      const res = await api.post(
        `/partners/orders/${orderId}/shiprocket-label`,
        { carrier: "shiprocket" },
        { headers: partnerHeaders }
      )
      expect(res.status).toBe(200)
      expect(res.data.shiprocket_label.awb).toBe("STUBAWB123")
    })

    it("400s when the partner's location cannot be registered — never ships from another party's warehouse", async () => {
      // Fixture location has NO phone → registration must fail loudly instead
      // of falling back to the shared account's first registered pickup.
      const res = await api
        .post(
          `/partners/orders/${orderId}/shiprocket-label`,
          {},
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)
      expect(res.status).toBe(400)
      expect(res.data.message).toMatch(/could not be used as a carrier pickup/)
      expect(shiprocketStubState.lastAdhocBody).toBeUndefined()
    })
  })
})
