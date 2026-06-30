import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"

jest.setTimeout(60000)

const ETSY_SYNC_MODULE = "etsySync"

setupSharedTestSuite(() => {
  describe("Etsy Sync Plugin — admin API", () => {
    const { api, getContainer } = getSharedTestEnv()

    describe("GET /admin/etsy/status", () => {
      it("returns disconnected status when no account exists", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const res = await api.get("/admin/etsy/status", headers)

        expect(res.status).toBe(200)
        expect(res.data.connected).toBe(false)
        expect(res.data.account).toBeNull()
        expect(res.data.readiness).toBeDefined()
        expect(res.data.readiness.connected).toBe(false)
        expect(res.data.readiness.ready_to_publish).toBe(false)
      })
    })

    describe("GET /admin/etsy/settings", () => {
      it("returns empty settings when none saved", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const res = await api.get("/admin/etsy/settings", headers)

        expect(res.status).toBe(200)
        expect(res.data.settings).toBeDefined()
      })
    })

    describe("POST /admin/etsy/settings", () => {
      it("saves and retrieves settings", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const payload = {
          default_taxonomy_id: 1234,
          default_who_made: "i_did",
          default_when_made: "made_to_order",
          default_is_supply: false,
          default_type: "physical",
          follow_product_status: true,
        }

        const saveRes = await api.post(
          "/admin/etsy/settings",
          payload,
          headers
        )
        expect(saveRes.status).toBe(200)
        expect(saveRes.data.settings.default_taxonomy_id).toBe(1234)
        expect(saveRes.data.settings.default_who_made).toBe("i_did")
        expect(saveRes.data.settings.follow_product_status).toBe(true)

        const getRes = await api.get("/admin/etsy/settings", headers)
        expect(getRes.status).toBe(200)
        expect(getRes.data.settings.default_taxonomy_id).toBe(1234)
        expect(getRes.data.settings.default_type).toBe("physical")
      })
    })

    describe("GET /admin/etsy/syncs", () => {
      it("returns empty sync list initially", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const res = await api.get("/admin/etsy/syncs", headers)

        expect(res.status).toBe(200)
        expect(res.data.syncs).toBeDefined()
        expect(Array.isArray(res.data.syncs)).toBe(true)
        expect(res.data.count).toBeDefined()
      })

      it("supports pagination via take/skip", async () => {
        await createAdminUser(getContainer())
        const headers = await getAuthHeaders(api)

        const res = await api.get(
          "/admin/etsy/syncs?take=5&skip=0",
          headers
        )

        expect(res.status).toBe(200)
        expect(res.data.syncs.length).toBeLessThanOrEqual(5)
      })
    })

    describe("module resolution", () => {
      it("resolves the etsySync module from the container", async () => {
        const container = getContainer()
        const service = container.resolve(ETSY_SYNC_MODULE)
        expect(service).toBeDefined()
        expect(typeof service.getActiveAccount).toBe("function")
        expect(typeof service.getClient).toBe("function")
      })
    })
  })
})
