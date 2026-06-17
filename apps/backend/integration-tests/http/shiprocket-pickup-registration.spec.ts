import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"

jest.setTimeout(90 * 1000)

/**
 * Shiprocket pickup-location registration (#31, SHIPPING_PROVIDERS.md §9).
 *
 * Exercises the full route → helper → resolver → client chain for
 * `/admin/stock-locations/:id/shiprocket-pickup` (GET status, POST register)
 * without touching the live Shiprocket API:
 *  - creds come from the resolver's env-var fallback (no SocialPlatform record
 *    needed), and
 *  - the Shiprocket HTTP calls (`/auth/login`, `/settings/company/pickup`,
 *    `/settings/company/addpickup`) are stubbed via a stateful `global.fetch`
 *    mock — Shiprocket has no sandbox endpoint.
 */

type MockPickup = {
  pickup_location: string
  phone_verified: number
  address?: string
  phone?: string
  city?: string
  state?: string
  pin_code?: string
  id?: number
}

type MockState = { pickups: MockPickup[]; addCalls: number; loginCalls: number }

/**
 * Install a stateful Shiprocket fetch stub; non-Shiprocket URLs pass through.
 *
 * NOTE: `medusaIntegrationTestRunner` runs the server in-process, so this stub
 * sees the server's OWN fetch calls too. Native (undici) fetch must be invoked
 * bound to `globalThis` — calling it detached throws — so we bind the real
 * fetch before spying and route every non-Shiprocket URL straight through it.
 */
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
        state.loginCalls++
        return make({ token: "test-token-123" })
      }
      if (url.includes("/settings/company/pickup")) {
        return make({ data: { shipping_address: state.pickups } })
      }
      if (url.includes("/settings/company/addpickup")) {
        state.addCalls++
        const body = JSON.parse(init.body || "{}")
        state.pickups.push({
          pickup_location: body.pickup_location,
          phone_verified: 0,
          address: body.address,
          phone: body.phone,
          city: body.city,
          state: body.state,
          pin_code: body.pin_code,
          id: state.pickups.length + 1,
        })
        return make({ success: true, address: { pickup_code: body.pickup_location } })
      }
      return make({}, 404)
    })
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Admin API - Shiprocket pickup registration", () => {
    let adminHeaders: Record<string, any>
    let mock: ReturnType<typeof installShiprocketMock>
    let state: MockState
    let prevEmail: string | undefined
    let prevPassword: string | undefined

    beforeAll(async () => {
      // Resolver env-var fallback — avoids seeding a `category: shipping`
      // SocialPlatform record just to provide creds.
      prevEmail = process.env.SHIPROCKET_EMAIL
      prevPassword = process.env.SHIPROCKET_PASSWORD
      process.env.SHIPROCKET_EMAIL = "test@shiprocket.example"
      process.env.SHIPROCKET_PASSWORD = "secret"

      await createAdminUser(getContainer())
      adminHeaders = await getAuthHeaders(api)
    })

    afterAll(() => {
      if (prevEmail === undefined) delete process.env.SHIPROCKET_EMAIL
      else process.env.SHIPROCKET_EMAIL = prevEmail
      if (prevPassword === undefined) delete process.env.SHIPROCKET_PASSWORD
      else process.env.SHIPROCKET_PASSWORD = prevPassword
    })

    beforeEach(() => {
      state = { pickups: [], addCalls: 0, loginCalls: 0 }
      mock = installShiprocketMock(state)
    })

    afterEach(() => {
      mock?.mockRestore()
    })

    async function createLocation(address?: Record<string, any>) {
      const res = await api.post(
        "/admin/stock-locations",
        {
          name: `SR Warehouse ${Date.now()}`,
          address: {
            address_1: "1 Mill Road",
            city: "Jaipur",
            province: "RJ",
            postal_code: "302001",
            country_code: "IN",
            phone: "9999999999",
            ...address,
          },
        },
        adminHeaders
      )
      expect(res.status).toBe(200)
      return res.data.stock_location.id as string
    }

    it("GET returns null when the location has no pickup recorded", async () => {
      const locationId = await createLocation()
      const res = await api.get(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.pickup).toBeNull()
    })

    it("POST registers a new pickup and records the nickname on the location", async () => {
      const locationId = await createLocation()
      const expectedNickname = `warehouse-${locationId.slice(-8)}`

      const res = await api.post(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        {},
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.pickup.name).toBe(expectedNickname)
      expect(res.data.pickup.already_existed).toBe(false)
      // One add call against the carrier, with the deterministic nickname.
      expect(state.addCalls).toBe(1)
      expect(state.pickups.map((p) => p.pickup_location)).toContain(expectedNickname)

      // Nickname is now persisted → GET surfaces it.
      const statusRes = await api.get(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        adminHeaders
      )
      expect(statusRes.data.pickup).not.toBeNull()
      expect(statusRes.data.pickup.name).toBe(expectedNickname)
    })

    it("POST is idempotent — a re-register does not add a second carrier pickup", async () => {
      const locationId = await createLocation()
      const expectedNickname = `warehouse-${locationId.slice(-8)}`

      await api.post(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        {},
        adminHeaders
      )
      expect(state.addCalls).toBe(1)

      const second = await api.post(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        {},
        adminHeaders
      )
      expect(second.status).toBe(200)
      expect(second.data.pickup.name).toBe(expectedNickname)
      expect(second.data.pickup.already_existed).toBe(true)
      // No second add — the existing nickname was matched via the list call.
      expect(state.addCalls).toBe(1)
    })

    it("GET surfaces phone-verification status from the carrier list", async () => {
      const locationId = await createLocation()
      await api.post(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        {},
        adminHeaders
      )
      // Carrier OTP-verifies the pickup phone after registration.
      state.pickups.forEach((p) => (p.phone_verified = 1))

      const res = await api.get(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        adminHeaders
      )
      expect(res.data.pickup.phone_verified).toBe(true)
      expect(res.data.pickup.shippable).toBe(true)
    })

    it("GET marks an API pickup with a complete address shippable before phone OTP (#435)", async () => {
      const locationId = await createLocation()
      await api.post(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        {},
        adminHeaders
      )
      // Phone OTP is NOT done (mock leaves phone_verified=0), but the pickup
      // carries a full address — it's usable for live pickups.
      const res = await api.get(
        `/admin/stock-locations/${locationId}/shiprocket-pickup`,
        adminHeaders
      )
      expect(res.data.pickup.phone_verified).toBe(false)
      expect(res.data.pickup.shippable).toBe(true)
    })

    it("POST 400s when the location is missing a phone or postal code", async () => {
      const locationId = await createLocation({ phone: "", postal_code: "" })
      await expect(
        api.post(
          `/admin/stock-locations/${locationId}/shiprocket-pickup`,
          {},
          adminHeaders
        )
      ).rejects.toMatchObject({ response: { status: 400 } })
      expect(state.addCalls).toBe(0)
    })
  })
})
