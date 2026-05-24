import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

// Per-partner behavior tests for partner regions — clone-on-write and
// ref-counted DELETE. The wire-contract parity test lives in
// integration-tests/http/partner-api-parity/regions.spec.ts; this file
// covers the *behaviors* that are invisible to a shape-only diff.
//
// Background — apps/docs/notes/PARTNER_API_PARITY.md and
// feedback_partner_region_extend_not_lockdown memory:
//
//   • Clone-on-write — when a partner updates a region row that's
//     linked to more than one partner, we don't mutate in place
//     (would bleed across tenants). Instead we clone the row, move
//     this partner's link to the clone, and apply the update to the
//     clone. The other partners keep seeing the original.
//   • Ref-counted DELETE — partner DELETE always dismisses this
//     partner's link, but only actually deletes the region row when
//     this was the last partner linked.

async function createPartnerWithStore(
  api: any,
  adminHeaders: Record<string, any>,
  opts: { country?: string; currency?: string } = {}
) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-clone-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })

  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = { Authorization: `Bearer ${login1.data.token}` }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `CloneTest ${unique}`,
      handle: `clonetest-${unique}`,
      admin: { email, first_name: "Clone", last_name: "Test" },
    },
    { headers }
  )
  const partnerId = partnerRes.data.partner.id

  const login2 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  headers = { Authorization: `Bearer ${login2.data.token}` }

  const currenciesRes = await api.get("/admin/currencies", adminHeaders)
  const currencies = currenciesRes.data.currencies || []
  const usd = currencies.find((c: any) => c.code?.toLowerCase() === "usd")
  const currencyCode = opts.currency ?? String((usd || currencies[0]).code).toLowerCase()
  const country = opts.country ?? "us"

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Store ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `Channel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: [country] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Test St", city: "Anywhere", postal_code: "00000", country_code: country.toUpperCase() },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    currencyCode,
    storeId: storeRes.data.store.id,
    regionId: storeRes.data.region?.id,
  }
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("Partner regions — clone-on-write and ref-counted DELETE", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    describe("clone-on-write on update", () => {
      it("clones the region when more than one partner is linked", async () => {
        // Partner A creates a store + default region.
        const a = await createPartnerWithStore(api, adminHeaders, {
          country: "us",
          currency: "usd",
        })
        expect(a.regionId).toBeTruthy()

        // Partner B is manually linked to the SAME region row to set up
        // the shared-row scenario. (In real life this happens via the
        // country+currency match in createRegionStep, but we link
        // explicitly here to avoid coupling the test to that lookup.)
        const b = await createPartnerWithStore(api, adminHeaders, {
          country: "ca",
          currency: "cad",
        })
        const container = getContainer()
        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
        await remoteLink.create({
          partner: { partner_id: b.partnerId },
          [Modules.REGION]: { region_id: a.regionId },
        })

        // Sanity: partner B can now see partner A's region.
        const beforeBList = await api.get(
          `/partners/stores/${b.storeId}/regions`,
          { headers: b.headers }
        )
        const beforeBRegion = beforeBList.data.regions.find(
          (r: any) => r.id === a.regionId
        )
        expect(beforeBRegion).toBeDefined()
        expect(beforeBRegion.name).toBe("Default Region")

        // Partner A updates the shared region — should trigger clone.
        const updateRes = await api.post(
          `/partners/stores/${a.storeId}/regions/${a.regionId}`,
          { name: "Partner A's Region" },
          { headers: a.headers }
        )
        expect(updateRes.status).toBe(200)
        const newRegionId = updateRes.data.region.id

        // Partner A is now linked to a DIFFERENT region id.
        expect(newRegionId).not.toBe(a.regionId)
        expect(updateRes.data.region.name).toBe("Partner A's Region")

        // Partner B's view of the original region is untouched.
        const afterBList = await api.get(
          `/partners/stores/${b.storeId}/regions`,
          { headers: b.headers }
        )
        const afterBRegion = afterBList.data.regions.find(
          (r: any) => r.id === a.regionId
        )
        expect(afterBRegion).toBeDefined()
        expect(afterBRegion.name).toBe("Default Region")
      })

      it("updates in place when this is the only partner linked (sole owner)", async () => {
        const a = await createPartnerWithStore(api, adminHeaders, {
          country: "us",
          currency: "usd",
        })

        const updateRes = await api.post(
          `/partners/stores/${a.storeId}/regions/${a.regionId}`,
          { name: "Renamed In Place" },
          { headers: a.headers }
        )

        expect(updateRes.status).toBe(200)
        expect(updateRes.data.region.id).toBe(a.regionId)
        expect(updateRes.data.region.name).toBe("Renamed In Place")
      })
    })

    describe("ref-counted DELETE", () => {
      it("keeps the row alive when other partners are still linked", async () => {
        const a = await createPartnerWithStore(api, adminHeaders, {
          country: "us",
          currency: "usd",
        })
        const b = await createPartnerWithStore(api, adminHeaders, {
          country: "ca",
          currency: "cad",
        })

        const container = getContainer()
        const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any
        await remoteLink.create({
          partner: { partner_id: b.partnerId },
          [Modules.REGION]: { region_id: a.regionId },
        })

        // Partner A deletes the (shared) region.
        const delRes = await api.delete(
          `/partners/stores/${a.storeId}/regions/${a.regionId}`,
          { headers: a.headers }
        )
        expect(delRes.status).toBe(200)
        expect(delRes.data).toEqual({
          id: a.regionId,
          object: "region",
          deleted: true,
        })

        // Partner A no longer sees it.
        const aGet = await api
          .get(`/partners/stores/${a.storeId}/regions/${a.regionId}`, {
            headers: a.headers,
          })
          .catch((e: any) => e.response)
        expect(aGet.status).toBe(404)

        // Partner B still sees it — the row survived.
        const bGet = await api.get(
          `/partners/stores/${b.storeId}/regions/${a.regionId}`,
          { headers: b.headers }
        )
        expect(bGet.status).toBe(200)
        expect(bGet.data.region.id).toBe(a.regionId)
      })

      it("deletes the row when this was the last partner linked (sole owner)", async () => {
        const a = await createPartnerWithStore(api, adminHeaders, {
          country: "us",
          currency: "usd",
        })

        const delRes = await api.delete(
          `/partners/stores/${a.storeId}/regions/${a.regionId}`,
          { headers: a.headers }
        )
        expect(delRes.status).toBe(200)
        expect(delRes.data.deleted).toBe(true)

        // Admin can no longer find the row — it was actually deleted.
        const adminGet = await api
          .get(`/admin/regions/${a.regionId}`, adminHeaders)
          .catch((e: any) => e.response)
        expect(adminGet.status).toBe(404)
      })
    })
  })
})
