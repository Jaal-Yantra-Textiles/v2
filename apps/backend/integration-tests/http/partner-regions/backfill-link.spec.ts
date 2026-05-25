import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import backfillPartnerRegionLinks from "../../../src/scripts/backfill-partner-region-links"
import partnerRegionLink from "../../../src/links/partner-region"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

// Verifies the pre-deployment backfill that creates `partner_region`
// links from `store.default_region_id` for legacy partners. PR
// feat/partner-regions-admin-parity drops the default-region fallback
// from partner GET handlers, so without this backfill any pre-PR-A
// partner without an explicit link would see an empty region list
// after deploy.
//
// Scenarios covered:
//   1. A legacy partner (link missing, default_region_id present) gets
//      a new link and recovers their region.
//   2. A partner already linked is left untouched (idempotent).
//   3. Running the script twice in a row creates no duplicate links.

async function createPartnerWithStore(api: any, adminHeaders: Record<string, any>) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-backfill-${unique}@medusa-test.com`

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
      name: `BackfillTest ${unique}`,
      handle: `backfilltest-${unique}`,
      admin: { email, first_name: "Backfill", last_name: "Test" },
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
  const currencyCode = String((usd || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Store ${unique}`,
        supported_currencies: [{ currency_code: currencyCode, is_default: true }],
      },
      sales_channel: { name: `Channel ${unique}`, description: "Default" },
      region: { name: "Default Region", currency_code: currencyCode, countries: ["us"] },
      location: {
        name: "Warehouse",
        address: { address_1: "1 Test St", city: "Anywhere", postal_code: "00000", country_code: "US" },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    storeId: storeRes.data.store.id,
    regionId: storeRes.data.region?.id,
  }
}

async function countLinks(container: any, partnerId: string, regionId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { partner_id: partnerId, region_id: regionId },
    fields: ["partner_id"],
  })
  return data?.length ?? 0
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("scripts/backfill-partner-region-links", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("recovers a partner whose link was lost while default_region_id remains", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

      // Simulate the legacy state: store has default_region_id but the
      // partner_region link row was never created (or was dismissed).
      await remoteLink.dismiss({
        partner: { partner_id: a.partnerId },
        [Modules.REGION]: { region_id: a.regionId },
      })
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(0)

      // After my partner-API changes the partner sees no regions.
      const beforeList = await api.get(
        `/partners/stores/${a.storeId}/regions`,
        { headers: a.headers }
      )
      expect(beforeList.data.regions).toEqual([])

      // Run the backfill.
      await backfillPartnerRegionLinks({ container, args: [] } as any)

      // Link restored.
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(1)

      // Partner sees their region again.
      const afterList = await api.get(
        `/partners/stores/${a.storeId}/regions`,
        { headers: a.headers }
      )
      expect(afterList.data.regions.length).toBe(1)
      expect(afterList.data.regions[0].id).toBe(a.regionId)
    })

    it("is a no-op for partners already linked", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()

      // Provisioning already created the link.
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(1)

      await backfillPartnerRegionLinks({ container, args: [] } as any)

      // Still exactly one — no duplicate.
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(1)
    })

    it("is idempotent across consecutive runs", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

      // Dismiss to simulate the legacy state.
      await remoteLink.dismiss({
        partner: { partner_id: a.partnerId },
        [Modules.REGION]: { region_id: a.regionId },
      })

      await backfillPartnerRegionLinks({ container, args: [] } as any)
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(1)

      // Re-run — should not create a duplicate.
      await backfillPartnerRegionLinks({ container, args: [] } as any)
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(1)
    })

    it("--dry-run creates no links", async () => {
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

      await remoteLink.dismiss({
        partner: { partner_id: a.partnerId },
        [Modules.REGION]: { region_id: a.regionId },
      })

      await backfillPartnerRegionLinks({ container, args: ["--dry-run"] } as any)
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(0)
    })

    it("DRY_RUN=1 env var also triggers dry-run mode", async () => {
      // deploy/aws/scripts/run-backfill.sh passes DRY_RUN as an env var
      // (not as a positional arg). Both paths must lead to the same
      // dry-run behavior — without this, a "dry-run" deploy step
      // silently runs the real backfill (which is how the prod
      // migration ran for real instead of preview on 2026-05-25).
      const a = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

      await remoteLink.dismiss({
        partner: { partner_id: a.partnerId },
        [Modules.REGION]: { region_id: a.regionId },
      })

      const before = process.env.DRY_RUN
      process.env.DRY_RUN = "1"
      try {
        await backfillPartnerRegionLinks({ container, args: [] } as any)
      } finally {
        if (before === undefined) delete process.env.DRY_RUN
        else process.env.DRY_RUN = before
      }
      expect(await countLinks(container, a.partnerId, a.regionId!)).toBe(0)
    })
  })
})
