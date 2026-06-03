import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { getSharedTestEnv, setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"
import regionPropagateHandler from "../../../src/subscribers/region-propagate"
import partnerRegionLink from "../../../src/links/partner-region"

const TEST_PARTNER_PASSWORD = "supersecret"

jest.setTimeout(120 * 1000)

// Verifies the structural fix for roadmap item 0B: a region.created /
// region.updated subscriber that propagates the new region to every
// active partner. Sibling to the 0A backfill tests in backfill-link.spec.ts
// and backfill-store-currencies.spec.ts.
//
// Scenarios:
//   1. region.created → new partner_region link + supported_currencies
//      extended for every partner store.
//   2. Idempotent — re-invocation does not duplicate links or currencies.
//   3. Pre-existing partners-already-linked are skipped without error.
//   4. Admin endpoints — GET /admin/regions/:id/partner-coverage returns
//      counts; POST /admin/regions/:id/share-to-all runs the same
//      propagation manually and returns the result body.

async function createPartnerWithStore(
  api: any,
  adminHeaders: Record<string, any>
) {
  const unique = Date.now() + Math.random().toString(36).slice(2, 6)
  const email = `partner-propagate-${unique}@medusa-test.com`

  await api.post("/auth/partner/emailpass/register", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })

  const login1 = await api.post("/auth/partner/emailpass", {
    email,
    password: TEST_PARTNER_PASSWORD,
  })
  let headers: Record<string, string> = {
    Authorization: `Bearer ${login1.data.token}`,
  }

  const partnerRes = await api.post(
    "/partners",
    {
      name: `PropagateTest ${unique}`,
      handle: `propagatetest-${unique}`,
      admin: {
        email,
        first_name: "Propagate",
        last_name: "Test",
      },
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
  const inr = currencies.find((c: any) => c.code?.toLowerCase() === "inr")
  const currencyCode = String((inr || currencies[0]).code).toLowerCase()

  const storeRes = await api.post(
    "/partners/stores",
    {
      store: {
        name: `Store ${unique}`,
        supported_currencies: [
          { currency_code: currencyCode, is_default: true },
        ],
      },
      sales_channel: {
        name: `Channel ${unique}`,
        description: "Default",
      },
      region: {
        name: "Home Region",
        currency_code: currencyCode,
        countries: ["in"],
      },
      location: {
        name: "Warehouse",
        address: {
          address_1: "1 Test St",
          city: "Anywhere",
          postal_code: "00000",
          country_code: "IN",
        },
      },
    },
    { headers }
  )

  return {
    headers,
    partnerId,
    storeId: storeRes.data.store.id,
    homeRegionId: storeRes.data.region?.id,
  }
}

async function ensureCurrency(
  api: any,
  adminHeaders: Record<string, any>,
  code: string
) {
  // /admin/currencies seeds the platform with common codes already,
  // but defensively check before creating an admin region with one.
  const res = await api.get("/admin/currencies", adminHeaders)
  const have = (res.data.currencies || []).some(
    (c: any) => c.code?.toLowerCase() === code.toLowerCase()
  )
  if (!have) {
    throw new Error(
      `Currency ${code} not present in admin currencies — seed it before running this test.`
    )
  }
}

async function createAdminRegion(
  api: any,
  adminHeaders: Record<string, any>,
  opts: { name: string; currency_code: string; countries: string[] }
) {
  await ensureCurrency(api, adminHeaders, opts.currency_code)
  const res = await api.post("/admin/regions", opts, adminHeaders)
  return res.data.region
}

async function getPartnerRegionLinkCount(
  container: any,
  partnerId: string,
  regionId: string
) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    filters: { partner_id: partnerId, region_id: regionId },
    fields: ["partner_id"],
  })
  return data?.length ?? 0
}

// The region.created event bus dispatch is async — between
// createAdminRegion returning and the subscriber finishing there's a
// short window where `remoteLink.dismiss()` would race the subscriber
// re-creating the link. Wait for the link to exist (subscriber done)
// before we manipulate it.
async function waitForLink(
  container: any,
  partnerId: string,
  regionId: string,
  timeoutMs = 5000
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if ((await getPartnerRegionLinkCount(container, partnerId, regionId)) > 0)
      return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(
    `partner_region link for ${partnerId}↔${regionId} never appeared within ${timeoutMs}ms`
  )
}

async function getStoreSupportedCurrencies(container: any, storeId: string) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stores",
    filters: { id: storeId },
    fields: ["supported_currencies.currency_code"],
  })
  return ((data?.[0] as any)?.supported_currencies ?? []).map((c: any) =>
    String(c.currency_code).toLowerCase()
  )
}

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()

  describe("subscribers/region-propagate (roadmap 0B)", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("links the new region to every existing partner and extends supported_currencies", async () => {
      const partnerA = await createPartnerWithStore(api, adminHeaders)
      const partnerB = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()

      const region = await createAdminRegion(api, adminHeaders, {
        name: "Sub Region AU",
        currency_code: "aud",
        countries: ["au"],
      })

      // Invoke the subscriber directly — the same handler the event bus
      // wires up. This matches the order.placed pattern in
      // design-to-cart-flow.spec.ts and removes any event-bus flakiness.
      await regionPropagateHandler({
        event: { name: "region.created", data: { id: region.id } },
        container,
      } as any)

      // Both partners now have a link to the new region.
      expect(
        await getPartnerRegionLinkCount(container, partnerA.partnerId, region.id)
      ).toBe(1)
      expect(
        await getPartnerRegionLinkCount(container, partnerB.partnerId, region.id)
      ).toBe(1)

      // Both stores now include aud in supported_currencies.
      const aCurrencies = await getStoreSupportedCurrencies(
        container,
        partnerA.storeId
      )
      const bCurrencies = await getStoreSupportedCurrencies(
        container,
        partnerB.storeId
      )
      expect(aCurrencies).toContain("aud")
      expect(bCurrencies).toContain("aud")
    })

    it("is idempotent — re-invoking does not duplicate links or currencies", async () => {
      const partner = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()

      const region = await createAdminRegion(api, adminHeaders, {
        name: "Sub Region EU",
        currency_code: "eur",
        countries: ["de"],
      })

      // First propagation (the subscriber will also have fired from
      // region.created — re-invoke explicitly so the test owns the
      // ordering rather than racing the event bus).
      await regionPropagateHandler({
        event: { name: "region.created", data: { id: region.id } },
        container,
      } as any)
      expect(
        await getPartnerRegionLinkCount(container, partner.partnerId, region.id)
      ).toBe(1)
      const afterFirst = await getStoreSupportedCurrencies(
        container,
        partner.storeId
      )
      expect(afterFirst.filter((c) => c === "eur")).toHaveLength(1)

      // Second invocation should change nothing.
      await regionPropagateHandler({
        event: { name: "region.updated", data: { id: region.id } },
        container,
      } as any)
      expect(
        await getPartnerRegionLinkCount(container, partner.partnerId, region.id)
      ).toBe(1)
      const afterSecond = await getStoreSupportedCurrencies(
        container,
        partner.storeId
      )
      expect(afterSecond).toEqual(afterFirst)
    })
  })

  describe("admin/regions/:id/partner-coverage + share-to-all", () => {
    let adminHeaders: Record<string, any>

    beforeEach(async () => {
      const container = getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    it("GET partner-coverage returns total + linked counts and unlinked partners", async () => {
      const partner = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

      const region = await createAdminRegion(api, adminHeaders, {
        name: "Coverage Region",
        currency_code: "usd",
        countries: ["us"],
      })

      // Wait for the region.created subscriber to finish, then wipe the
      // auto-created link so this partner shows as unlinked.
      await waitForLink(container, partner.partnerId, region.id)
      await remoteLink.dismiss({
        partner: { partner_id: partner.partnerId },
        [Modules.REGION]: { region_id: region.id },
      })

      const res = await api.get(
        `/admin/regions/${region.id}/partner-coverage`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.region.id).toBe(region.id)
      expect(res.data.linked_partners).toBe(0)
      expect(res.data.total_partners).toBeGreaterThanOrEqual(1)
      const unlinkedIds = res.data.unlinked_partners.map((p: any) => p.id)
      expect(unlinkedIds).toContain(partner.partnerId)
    })

    it("POST share-to-all links unlinked partners and is idempotent", async () => {
      const partner = await createPartnerWithStore(api, adminHeaders)
      const container = getContainer()
      const remoteLink = container.resolve(ContainerRegistrationKeys.LINK) as any

      const region = await createAdminRegion(api, adminHeaders, {
        name: "Share Region",
        currency_code: "gbp",
        countries: ["gb"],
      })

      // Wait for region.created subscriber, then strip the auto-created
      // link so share-to-all has actual work to do.
      await waitForLink(container, partner.partnerId, region.id)
      await remoteLink.dismiss({
        partner: { partner_id: partner.partnerId },
        [Modules.REGION]: { region_id: region.id },
      })

      const first = await api.post(
        `/admin/regions/${region.id}/share-to-all`,
        { trigger_fanout: false },
        adminHeaders
      )
      expect(first.status).toBe(200)
      expect(first.data.result.links_created).toBeGreaterThanOrEqual(1)
      expect(first.data.result.errors).toEqual([])

      // Idempotent re-run.
      const second = await api.post(
        `/admin/regions/${region.id}/share-to-all`,
        { trigger_fanout: false },
        adminHeaders
      )
      expect(second.status).toBe(200)
      expect(second.data.result.links_created).toBe(0)
      expect(second.data.result.links_already_existing).toBeGreaterThanOrEqual(1)
      expect(second.data.result.errors).toEqual([])

      // gbp now on the partner's store.
      const currencies = await getStoreSupportedCurrencies(
        container,
        partner.storeId
      )
      expect(currencies).toContain("gbp")
    })
  })
})
