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
 * courier before Generate-Label. Shiprocket has no sandbox, so the HTTP calls
 * (`/auth/login`, `/settings/company/pickup`, `/courier/serviceability/`) are
 * stubbed via a stateful `global.fetch` mock (mirrors the pickup-registration
 * spec). Creds come from the resolver's env-var fallback.
 */

type MockState = { serviceabilityCalls: number; lastQuery?: URLSearchParams }

function installShiprocketMock(state: MockState) {
  const realFetch = global.fetch.bind(globalThis)
  return jest
    .spyOn(global, "fetch" as any)
    .mockImplementation(async (input: any, init: any = {}) => {
      const url = String(input)
      const make = (body: any, status = 200) =>
        ({
          ok: status >= 200 && status < 300,
          status,
          json: async () => body,
          text: async () => JSON.stringify(body),
        } as any)

      if (!url.includes("shiprocket.in")) {
        return realFetch(input, init)
      }
      if (url.endsWith("/auth/login")) {
        return make({ token: "test-token-123" })
      }
      if (url.includes("/settings/company/pickup")) {
        return make({
          data: {
            shipping_address: [
              {
                pickup_location: "warehouse-primary",
                phone_verified: 1,
                address: "1 Mill Road",
                phone: "9999999999",
                city: "Jaipur",
                state: "RJ",
                pin_code: "302001",
                id: 1,
              },
            ],
          },
        })
      }
      if (url.includes("/courier/serviceability/")) {
        state.serviceabilityCalls++
        const qIndex = url.indexOf("?")
        state.lastQuery = new URLSearchParams(
          qIndex >= 0 ? url.slice(qIndex + 1) : ""
        )
        return make({
          data: {
            recommended_courier_company_id: 51,
            available_courier_companies: [
              {
                courier_company_id: 51,
                courier_name: "Xpressbees Surface",
                rate: 78,
                estimated_delivery_days: "4",
                cod_charges: 35,
              },
              {
                courier_company_id: 12,
                courier_name: "Delhivery Air",
                rate: 121,
                estimated_delivery_days: "2",
                cod_charges: 40,
              },
            ],
          },
        })
      }
      return make({}, 404)
    })
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin API - Shiprocket courier rates (#641)", () => {
    let adminHeaders: { headers: Record<string, string> }
    let customerHeaders: { headers: Record<string, string> }
    let designId: string
    let regionId: string
    let orderId: string
    let mock: ReturnType<typeof installShiprocketMock>
    let state: MockState
    let prevEmail: string | undefined
    let prevPassword: string | undefined

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
      process.env.SHIPROCKET_EMAIL = "test@shiprocket.example"
      // Set both names so the spec passes regardless of whether the #642
      // resolver env-fallback (SHIPROCKET_API_PASSWORD) has merged yet.
      process.env.SHIPROCKET_PASSWORD = "secret"
      process.env.SHIPROCKET_API_PASSWORD = "secret"

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

      // One converted design order, reused (read-only) across both tests.
      orderId = await buildDesignOrderId()
    })

    afterAll(() => {
      if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL
      else process.env.SHIPROCKET_EMAIL = prevEmail
      delete process.env.SHIPROCKET_API_PASSWORD
      if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD
      else process.env.SHIPROCKET_PASSWORD = prevPassword
    })

    beforeEach(() => {
      state = { serviceabilityCalls: 0 }
      mock = installShiprocketMock(state)
    })

    afterEach(() => {
      mock?.mockRestore()
    })

    it("returns the courier list (recommended flag) and honours a weight override", async () => {
      // ── default weight ────────────────────────────────────────────────
      const res = await api.get(
        `/admin/orders/${orderId}/shiprocket-rates`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      // Origin from the registered pickup, destination from the order address.
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

      // The serviceability lane carried the resolved origin/destination.
      expect(state.serviceabilityCalls).toBe(1)
      expect(state.lastQuery?.get("pickup_postcode")).toBe("302001")
      expect(state.lastQuery?.get("delivery_postcode")).toBe("10001")

      // ── weight_grams override ─────────────────────────────────────────
      const res2 = await api.get(
        `/admin/orders/${orderId}/shiprocket-rates?weight_grams=1500`,
        adminHeaders
      )
      expect(res2.status).toBe(200)
      expect(res2.data.weight_grams).toBe(1500)
      // getRates sends weight in kg.
      expect(state.lastQuery?.get("weight")).toBe("1.5")
    })
  })
})
