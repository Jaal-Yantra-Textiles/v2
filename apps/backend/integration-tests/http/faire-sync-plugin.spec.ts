import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

const FAIRE_SYNC_MODULE = "faireSync"

setupSharedTestSuite(() => {
  describe("Faire Sync Plugin — admin API", () => {
    const { api, getContainer } = getSharedTestEnv()

    describe("GET /admin/faire/status", () => {
      it("returns disconnected status when no account exists", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const res = await api.get("/admin/faire/status", headers)

        expect(res.status).toBe(200)
        expect(res.data.connected).toBe(false)
        expect(res.data.account).toBeNull()
        expect(res.data.readiness).toBeDefined()
        expect(res.data.readiness.connected).toBe(false)
      })
    })

    describe("GET /admin/faire/settings", () => {
      it("returns empty settings when none saved", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const res = await api.get("/admin/faire/settings", headers)

        expect(res.status).toBe(200)
        expect(res.data.settings).toBeDefined()
      })
    })

    describe("POST /admin/faire/settings", () => {
      it("saves and retrieves settings", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const payload = {
          default_brand_id: "b_test",
          default_wholesale_markup_percent: 25,
          default_min_order_quantity: 1,
          follow_product_status: true,
        }

        const saveRes = await api.post(
          "/admin/faire/settings",
          payload,
          headers
        )
        expect(saveRes.status).toBe(200)
        expect(saveRes.data.settings.default_brand_id).toBe("b_test")
        expect(saveRes.data.settings.default_wholesale_markup_percent).toBe(25)

        const getRes = await api.get("/admin/faire/settings", headers)
        expect(getRes.status).toBe(200)
        expect(getRes.data.settings.follow_product_status).toBe(true)
      })
    })

    describe("GET /admin/faire/syncs", () => {
      it("returns empty sync list initially", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const res = await api.get("/admin/faire/syncs", headers)

        expect(res.status).toBe(200)
        expect(res.data.syncs).toBeDefined()
        expect(Array.isArray(res.data.syncs)).toBe(true)
        expect(res.data.count).toBeDefined()
      })
    })

    describe("module resolution", () => {
      it("resolves the faireSync module from the container", async () => {
        const container = getContainer()
        const service = container.resolve(FAIRE_SYNC_MODULE)
        expect(service).toBeDefined()
        expect(typeof service.getActiveAccount).toBe("function")
        expect(typeof service.getClient).toBe("function")
      })
    })
  })
})
