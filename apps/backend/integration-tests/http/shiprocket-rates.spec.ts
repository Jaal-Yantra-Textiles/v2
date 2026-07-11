import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IRegionModuleService } from "@medusajs/types"

import { setupSharedTestSuite, getSharedTestEnv } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import {
  createTestCustomer,
  getCustomerAuthHeaders,
  getTestCustomerCredentials,
} from "../helpers/create-customer"
import { setupCheckoutInfrastructure } from "../helpers/setup-checkout-infrastructure"
import { DESIGN_MODULE } from "../../src/modules/designs"

jest.setTimeout(120 * 1000)

/**
 * #641 — `GET /admin/orders/:id/shiprocket-rates` surfaces the courier options
 * (rate / ETA / recommended) for an order so the Design-Orders UI can pick a
 * courier before Generate-Label.
 *
 * Shiprocket has no sandbox. Rather than patch `global.fetch` (which does NOT
 * reliably intercept the in-process server's own fetch in CI — the route then
 * hits the real API and 401s, #647), we set `SHIPROCKET_STUB=1`: the resolver
 * injects a deterministic stub transport (`shiprocket/stub-fetch.ts`) into the
 * client, so the server uses canned responses regardless of the global. Creds
 * come from the resolver's env-var fallback.
 */

setupSharedTestSuite(() => {
  const { api, getContainer, dbUtils } = getSharedTestEnv()

  describe("Admin API - Shiprocket courier rates (#641)", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string
    let orderId: string
    let prevEmail: string | undefined
    let prevPassword: string | undefined
    let prevStub: string | undefined
    let prevDelhiveryToken: string | undefined

    const buildDesignOrderId = async (): Promise<string> => {
      const cartRes = await api.post(
        "/store/carts",
        { region_id: regionId },
        customerHeaders
      )
      const cartId = cartRes.data.cart.id
      const checkoutRes = await api.post(
        `/store/custom/designs/${designId}/checkout`,
        { cart_id: cartId, currency_code: "usd" },
        customerHeaders
      )
      const lineItemId = checkoutRes.data.line_item_id
      const credentials = getTestCustomerCredentials()
      await api.post(
        `/store/carts/${cartId}`,
        {
          email: credentials.email,
          shipping_address: {
            first_name: "Test",
            last_name: "Customer",
            address_1: "123 Main St",
            city: "New York",
            postal_code: "10001",
            country_code: "us",
          },
        },
        customerHeaders
      )
      const convertRes = await api.post(
        `/admin/designs/orders/${lineItemId}/convert`,
        { payment_mode: "prepaid" },
        adminHeaders
      )
      expect(convertRes.status).toBe(200)
      return convertRes.data.design_order_conversion.order_id
    }

    beforeAll(async () => {
      const container = getContainer()
      prevEmail = process.env.SHIPROCKET_EMAIL
      prevPassword = process.env.SHIPROCKET_PASSWORD
      prevStub = process.env.SHIPROCKET_STUB
      prevDelhiveryToken = process.env.DELHIVERY_API_TOKEN
      process.env.SHIPROCKET_EMAIL = "test@shiprocket.example"
      process.env.SHIPROCKET_PASSWORD = "secret"
      process.env.DELHIVERY_API_TOKEN = "test-delhivery-token"
      // Make the resolver inject the canned Shiprocket transport (no real API).
      process.env.SHIPROCKET_STUB = "1"

      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)

      const regionsRes = await api.get("/admin/regions", adminHeaders)
      if (regionsRes.data.regions?.length > 0) {
        regionId = regionsRes.data.regions[0].id
      } else {
        const regionService = container.resolve(
          Modules.REGION
        ) as IRegionModuleService
        const region = await regionService.createRegions({
          name: "Rates Region",
          currency_code: "usd",
          countries: ["us"],
        })
        regionId = region.id
      }

      const designRes = await api.post(
        "/admin/designs",
        {
          name: `Rates Design ${Date.now()}`,
          description: "shiprocket rates test",
          design_type: "Original",
          status: "Commerce_Ready",
          priority: "Medium",
          estimated_cost: 250,
        },
        adminHeaders
      )
      designId = designRes.data.design.id
      await setupCheckoutInfrastructure(container, regionId)

      const { customer } = await createTestCustomer(container)
      customerHeaders = await getCustomerAuthHeaders()
      const remoteLink = container.resolve(
        ContainerRegistrationKeys.LINK
      ) as any
      await remoteLink
        .create({
          [DESIGN_MODULE]: { design_id: designId },
          [Modules.CUSTOMER]: { customer_id: customer.id },
        })
        .catch(() => {})

      // NOTE: the store-side fixtures (cart → design checkout → address) are
      // built inside the `it` below, NOT here — the shared test runner only
      // settles its default data (incl. the customer publishable key + its
      // sales-channel link) once the first `it` is in flight; building them in
      // `beforeAll` 401s on a freshly-migrated CI DB. convert-design-order.spec
      // builds its order inside `it` for the same reason — we mirror it.
    })

    afterAll(() => {
      if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL
      else process.env.SHIPROCKET_EMAIL = prevEmail
      if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD
      else process.env.SHIPROCKET_PASSWORD = prevPassword
      if (prevStub === undefined) delete process.env.SHIPROCKET_STUB
      else process.env.SHIPROCKET_STUB = prevStub
      if (prevDelhiveryToken === undefined) delete process.env.DELHIVERY_API_TOKEN
      else process.env.DELHIVERY_API_TOKEN = prevDelhiveryToken
    })

    it("returns the courier list (recommended flag) and honours a weight override", async () => {
      // Build the converted design order inside the `it` (see the note in
      // beforeAll). The Shiprocket transport is stubbed via SHIPROCKET_STUB, so
      // the rates route uses canned data instead of the real API.
      orderId = await buildDesignOrderId()

      // Snapshot the DB so subsequent tests in this describe share the order
      await dbUtils.snapshot()

      // ── default weight ────────────────────────────────────────────────
      const res = await api.get(
        `/admin/orders/${orderId}/shiprocket-rates`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      // Origin from the registered pickup (stub), destination from the order address.
      expect(res.data.origin_pincode).toBe("302001")
      expect(res.data.destination_pincode).toBe("10001")
      expect(res.data.cod).toBe(false)

      const rates = res.data.rates
      expect(Array.isArray(rates)).toBe(true)
      expect(rates.length).toBe(2)
      const recommended = rates.find((r: any) => r.is_recommended)
      expect(recommended?.courier_id).toBe(51)
      expect(recommended?.courier_name).toBe("Xpressbees Surface")
      expect(recommended?.amount).toBe(78)
      expect(recommended?.estimated_days).toBe(4)

      // ── weight_grams override ─────────────────────────────────────────
      const res2 = await api.get(
        `/admin/orders/${orderId}/shiprocket-rates?weight_grams=1500`,
        adminHeaders
      )
      expect(res2.status).toBe(200)
      expect(res2.data.weight_grams).toBe(1500)
    })

    it("accepts an explicit carrier query param (shiprocket)", async () => {
      const res = await api.get(
        `/admin/orders/${orderId}/shiprocket-rates?carrier=shiprocket`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.rates)).toBe(true)
      expect(res.data.rates.length).toBe(2)
    })

    it("rejects carrier=delhivery (no courier picker for Delhivery)", async () => {
      const res = await api.get(
        `/admin/orders/${orderId}/shiprocket-rates?carrier=delhivery`,
        { ...adminHeaders, validateStatus: () => true }
      )
      // Delhivery does not implement listPickupLocations, so the rates
      // workflow returns NOT_ALLOWED (400). The UI must not call this
      // endpoint for Delhivery — the carrier picker is gated on
      // `carrier === "shiprocket"`.
      expect(res.status).toBe(400)
    })

    it("responds on the carrier-neutral fulfillment-rates alias route (#835)", async () => {
      const res = await api.get(
        `/admin/orders/${orderId}/fulfillment-rates`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.origin_pincode).toBe("302001")
      expect(Array.isArray(res.data.rates)).toBe(true)
      expect(res.data.rates.length).toBe(2)
    })

    it("carrier-neutral fulfillment-rates alias honours ?carrier=shiprocket", async () => {
      const res = await api.get(
        `/admin/orders/${orderId}/fulfillment-rates?carrier=shiprocket`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(Array.isArray(res.data.rates)).toBe(true)
    })

    it("carrier-neutral fulfillment-rates alias rejects ?carrier=delhivery (no courier picker)", async () => {
      const res = await api.get(
        `/admin/orders/${orderId}/fulfillment-rates?carrier=delhivery`,
        { ...adminHeaders, validateStatus: () => true }
      )
      expect(res.status).toBe(400)
    })
  })
})
