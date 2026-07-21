import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { shiprocketStubState } from "../../src/modules/shipping-providers/shiprocket/stub-fetch"

const PARTNER_PASSWORD = "supersecret"
const WEBHOOK_SECRET = "test-core-webhook-secret"

jest.setTimeout(120 * 1000)

/**
 * #1111 — the carrier tracking webhook advances RETAIL/CORE-order fulfillments,
 * not just inventory shipments. A core order's Shiprocket label stamps the AWB
 * onto a `fulfillment_label`; a delivered push then routes AWB → fulfillment and
 * marks it shipped + delivered (forward-only). Works for domestic + intl; this
 * exercises a US (international) order end-to-end.
 */
setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("POST /webhooks/shipping/track — core-order fulfillment (#1111)", () => {
    let adminHeaders: any
    let partnerHeaders: any
    let locationId: string
    let salesChannelId: string
    let regionId: string
    let orderId: string
    let awb: string

    let prevEmail: string | undefined
    let prevPassword: string | undefined
    let prevStub: string | undefined
    let prevSecret: string | undefined

    beforeAll(() => {
      prevEmail = process.env.SHIPROCKET_EMAIL
      prevPassword = process.env.SHIPROCKET_PASSWORD
      prevStub = process.env.SHIPROCKET_STUB
      prevSecret = process.env.SHIPPING_WEBHOOK_SECRET
      process.env.SHIPROCKET_EMAIL = "test@shiprocket.example"
      process.env.SHIPROCKET_PASSWORD = "secret"
      process.env.SHIPROCKET_STUB = "1"
      process.env.SHIPPING_WEBHOOK_SECRET = WEBHOOK_SECRET
    })

    afterAll(() => {
      if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL
      else process.env.SHIPROCKET_EMAIL = prevEmail
      if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD
      else process.env.SHIPROCKET_PASSWORD = prevPassword
      if (prevStub === undefined) delete process.env.SHIPROCKET_STUB
      else process.env.SHIPROCKET_STUB = prevStub
      if (prevSecret === undefined) delete process.env.SHIPPING_WEBHOOK_SECRET
      else process.env.SHIPPING_WEBHOOK_SECRET = prevSecret
      shiprocketStubState.awbOverride = undefined
    })

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const unique = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
      // Unique AWB so this shipment's webhook can't collide with another spec's
      // STUBAWB123 in the shared DB (the inventory path would otherwise match).
      awb = `COREAWB${unique}`
      shiprocketStubState.awbOverride = awb

      const email = `trk-${unique}@t.com`
      await api.post("/auth/partner/emailpass/register", { email, password: PARTNER_PASSWORD })
      const login1 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
      let headers: any = { Authorization: `Bearer ${login1.data.token}` }
      await api.post(
        "/partners",
        { name: `Trk ${unique}`, handle: `trk-${unique}`, admin: { email, first_name: "T", last_name: unique } },
        { headers }
      )
      const login2 = await api.post("/auth/partner/emailpass", { email, password: PARTNER_PASSWORD })
      partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

      await api
        .post("/admin/shipping-profiles", { name: `default-${unique}`, type: "default" }, adminHeaders)
        .catch(() => {})

      const storeRes = await api.post(
        "/partners/stores",
        {
          store: { name: `TStore ${unique}`, supported_currencies: [{ currency_code: "usd", is_default: true }] },
          sales_channel: { name: `TChannel ${unique}`, description: "Default" },
          region: { name: `T Region ${unique}`, currency_code: "usd", countries: ["us"] },
          location: {
            name: "T Warehouse",
            address: { address_1: "1 Loom St", city: "Surendranagar", province: "GJ", postal_code: "363035", country_code: "IN" },
          },
        },
        { headers: partnerHeaders }
      )
      locationId = storeRes.data.location?.id
      salesChannelId = storeRes.data.sales_channel?.id
      regionId = storeRes.data.region?.id

      await api.post(
        `/admin/stock-locations/${locationId}`,
        { address: { address_1: "1 Loom St", city: "Surendranagar", province: "GJ", postal_code: "363035", country_code: "IN", phone: "9990001112" } },
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
      const profiles = await api.get("/admin/shipping-profiles?limit=1", adminHeaders)
      const profileId = profiles.data.shipping_profiles?.[0]?.id
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

      const draft = await api.post(
        "/admin/draft-orders",
        {
          email: "buyer@t.com",
          region_id: regionId,
          sales_channel_id: salesChannelId,
          currency_code: "usd",
          shipping_address: {
            first_name: "Elena", last_name: "Doe", address_1: "9 Buyer Rd",
            city: "Dallas", province: "TX", postal_code: "75201", country_code: "us", phone: "8887776665",
          },
          items: [{ title: "Tangaliya Stole", quantity: 1, unit_price: 1500, metadata: { hsn: "621410" } }],
        },
        adminHeaders
      )
      const draftId = draft.data.draft_order?.id
      const converted = await api.post(`/admin/draft-orders/${draftId}/convert-to-order`, {}, adminHeaders)
      orderId = converted.data.order?.id ?? draftId

      // Generate the label → creates the fulfillment + the AWB fulfillment_label.
      const label = await api.post(`/partners/orders/${orderId}/shiprocket-label`, {}, { headers: partnerHeaders })
      expect(label.status).toBe(200)
      expect(label.data.shiprocket_label.awb).toBe(awb)
    })

    const fetchOrder = async (): Promise<any> => {
      const res = await api.get(
        `/admin/orders/${orderId}?fields=id,fulfillment_status,fulfillments.id,fulfillments.shipped_at,fulfillments.delivered_at,fulfillments.data`,
        adminHeaders
      )
      return res.data.order
    }

    const waitFor = async (predicate: () => Promise<boolean>, timeoutMs = 25000): Promise<boolean> => {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        if (await predicate()) return true
        await new Promise((r) => setTimeout(r, 400))
      }
      return false
    }

    const push = async (payload: any, token: string | null = WEBHOOK_SECRET) => {
      const qs = token ? `?token=${token}` : ""
      return api.post(`/webhooks/shipping/track${qs}`, payload).catch((e: any) => e.response)
    }

    const deliveredPayload = () => ({
      awb,
      current_status: "DELIVERED",
      current_status_id: 7,
      shipment_status: "DELIVERED",
      shipment_status_id: 7,
      scans: [{ date: "2026-07-06 14:00", status: "Delivered", location: "Dallas" }],
    })

    it("a delivered push marks the core fulfillment shipped + delivered", async () => {
      const res = await push(deliveredPayload())
      expect(res.status).toBe(200)

      const landed = await waitFor(async () => (await fetchOrder()).fulfillment_status === "delivered")
      expect(landed).toBe(true)

      const order = await fetchOrder()
      const f = order.fulfillments?.[0]
      expect(f?.shipped_at).toBeTruthy()
      expect(f?.delivered_at).toBeTruthy()
      // The scan history is recorded on the fulfillment data blob.
      expect(Array.isArray(f?.data?.tracking_events)).toBe(true)
      expect(f.data.tracking_events.length).toBeGreaterThan(0)
    })

    it("a later pre-delivery push never regresses a delivered fulfillment", async () => {
      await push(deliveredPayload())
      await waitFor(async () => (await fetchOrder()).fulfillment_status === "delivered")

      const late = await push({
        awb,
        current_status: "IN TRANSIT",
        current_status_id: 20,
        shipment_status_id: 18,
        scans: [{ date: "2026-07-05 09:00", status: "In transit", location: "Mumbai" }],
      })
      expect(late.status).toBe(200)
      await new Promise((r) => setTimeout(r, 1500))
      const order = await fetchOrder()
      expect(order.fulfillment_status).toBe("delivered")
      expect(order.fulfillments?.[0]?.delivered_at).toBeTruthy()
    })
  })
})
