import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { deriveDomainPair } from "../../src/workflows/partners/attach-storefront-domain"

jest.setTimeout(60000)

// Roadmap #17 (issue #346): a partner custom domain attaches as a www+apex
// pair. deriveDomainPair is the single source of the pairing rule; the
// alias-registration behaviour is pinned through the website module.

// Pure-function tests live OUTSIDE the shared suite — they need no DB,
// and the suite's per-test TRUNCATE can deadlock against the index
// engine's boot-time sync.
describe("deriveDomainPair", () => {
  it("derives www/apex twins (and none for deeper subdomains)", () => {
    expect(deriveDomainPair("example.com")).toEqual({
      primary: "example.com",
      counterpart: "www.example.com",
    })
    expect(deriveDomainPair("www.example.com")).toEqual({
      primary: "www.example.com",
      counterpart: "example.com",
    })
    expect(deriveDomainPair("shop.example.com")).toEqual({
      primary: "shop.example.com",
      counterpart: null,
    })
    // www at depth 3+ is itself a subdomain of a subdomain — no twin
    expect(deriveDomainPair("www.shop.example.com")).toEqual({
      primary: "www.shop.example.com",
      counterpart: null,
    })
  })
})

setupSharedTestSuite(() => {
  describe("storefront domain pairing", () => {
    const { api, getContainer } = getSharedTestEnv()

    it("registers both pair hosts as website_domain aliases (resolvable via /web/website)", async () => {
      const container = getContainer()
      await createAdminUser(container)
      const adminHeaders = await getAuthHeaders(api)
      const unique = Date.now()

      // Create a website to alias against
      const siteRes = await api.post(
        "/admin/websites",
        {
          name: `Pair Test ${unique}`,
          domain: `pair-${unique}.cicilabel.com`,
          status: "Active",
        },
        adminHeaders
      )
      expect([200, 201]).toContain(siteRes.status)
      const websiteId = siteRes.data.website.id

      // Same upsert the workflow's registerWebsiteAliasesStep performs
      const websiteService: any = container.resolve("websites")
      for (const host of [`pair-${unique}.com`, `www.pair-${unique}.com`]) {
        const [existing] = await websiteService.listAndCountWebsiteDomains(
          { domain: host },
          { take: 1 }
        )
        if (!existing?.length) {
          await websiteService.createWebsiteDomains({
            domain: host,
            is_primary: false,
            website_id: websiteId,
          })
        }
      }

      // Both forms must resolve through the public host-based lookup
      for (const host of [`pair-${unique}.com`, `www.pair-${unique}.com`]) {
        const res = await api.get(`/web/website/${host}`, {
          validateStatus: () => true,
        })
        expect(res.status).toBe(200)
        expect(res.data.name).toBe(`Pair Test ${unique}`)
      }
    })
  })
})
