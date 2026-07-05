import { setupSharedTestSuite } from "../shared-test-setup"
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user"

jest.setTimeout(100000)

setupSharedTestSuite(({ api, getContainer }) => {
  describe("GET /admin/websites/:id/analytics/search-console — GSC rollup (#894)", () => {
    let websiteId: string
    let adminHeaders: { headers: Record<string, string> }

    beforeAll(async () => {
      const container = await getContainer()
      await createAdminUser(container)
      adminHeaders = await getAuthHeaders(api)
    })

    beforeEach(async () => {
      const container = await getContainer()
      const websiteService = container.resolve("websites")
      const socials: any = container.resolve("socials")
      const platformId = `test-platform-${Date.now()}`

      const website = await websiteService.createWebsites({
        domain: `gsc-${Date.now()}.example.com`,
        name: "GSC Analytics Test Site",
        status: "Active",
        primary_language: "en",
      })
      websiteId = website.id

      // Create a test platform (simulates a Google Business Manager connection)
      await socials.createSocialPlatforms({
        id: platformId,
        name: "Test Google Platform",
        category: "google",
        auth_type: "oauth2",
        status: "active",
        api_config: { test: true },
      })

      // Create a search-console binding for the website's domain
      const domain = website.domain
      await socials.createSocialPlatformBindings({
        platform_id: platformId,
        service: "search-console",
        resource_id: `sc-domain:${domain}`,
        resource_label: domain,
        status: "active",
      })

      // Create the GSC site row (as if a sync had run)
      const [site] = await socials.createGoogleSearchConsoleSites({
        site_url: `sc-domain:${domain}`,
        platform_id: platformId,
        binding_id: (await socials.listSocialPlatformBindings({ service: "search-console", platform_id: platformId }))[0].id,
        sync_status: "synced",
        permission_level: "siteOwner",
        last_synced_at: new Date(),
      })

      // Seed GSC insights rows for the last 30 days
      const rows: any[] = []
      const today = new Date()
      for (let i = 29; i >= 0; i--) {
        const d = new Date(today)
        d.setDate(d.getDate() - i)
        const dateStr = d.toISOString().split("T")[0]

        rows.push({
          site_id: site.id,
          date: dateStr,
          query: "winter dress",
          page: "https://example.com/products/dress",
          clicks: 10 - (i % 3),
          impressions: 100 - (i % 7) * 2,
          ctr: 0.1,
          position: 4.2 + (i % 10) * 0.1,
          synced_at: new Date(),
        })
        rows.push({
          site_id: site.id,
          date: dateStr,
          query: "summer top",
          page: "https://example.com/collections/summer",
          clicks: 5 + (i % 4),
          impressions: 80 - (i % 5),
          ctr: 0.0625,
          position: 6.1 + (i % 8) * 0.1,
          synced_at: new Date(),
        })
        rows.push({
          site_id: site.id,
          date: dateStr,
          query: "summer top",
          page: "https://example.com/products/top",
          clicks: 3 + (i % 2),
          impressions: 40 - (i % 3),
          ctr: 0.075,
          position: 5.5 + (i % 6) * 0.1,
          synced_at: new Date(),
        })
      }
      await socials.createGoogleSearchConsoleInsights(rows)
    })

    it("returns GSC rollup with total, timeseries, top_queries, and top_pages", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/search-console?days=30`,
        adminHeaders
      )
      expect(res.status).toBe(200)

      const body = res.data
      expect(body.bound).toBe(true)
      expect(body.synced).toBe(true)
      expect(body.binding).toMatchObject({
        resource_id: expect.stringContaining("sc-domain:"),
        matched_via: "sc_domain",
      })

      // Total should be non-zero (30 days * 3 rows/day with positive clicks)
      expect(body.total.clicks).toBeGreaterThan(0)
      expect(body.total.impressions).toBeGreaterThan(0)
      expect(body.total.ctr).toBeGreaterThan(0)
      expect(body.total.position).toBeGreaterThan(0)

      // Timeseries: one entry per day
      expect(body.timeseries).toHaveLength(30)
      expect(body.timeseries[0]).toHaveProperty("date")
      expect(body.timeseries[0]).toHaveProperty("clicks")
      expect(body.timeseries[0]).toHaveProperty("impressions")
      expect(body.timeseries[0]).toHaveProperty("ctr")
      expect(body.timeseries[0]).toHaveProperty("position")

      // Top queries: should be sorted by clicks desc, capped at 10
      expect(body.top_queries.length).toBeGreaterThan(0)
      expect(body.top_queries.length).toBeLessThanOrEqual(10)
      expect(body.top_queries[0].clicks).toBeGreaterThanOrEqual(
        body.top_queries[body.top_queries.length - 1]?.clicks ?? 0
      )

      // Top pages: same pattern
      expect(body.top_pages.length).toBeGreaterThan(0)
      expect(body.top_pages.length).toBeLessThanOrEqual(10)
    })

    it("returns bound:false for a website with no GSC binding", async () => {
      const container = await getContainer()
      const websiteService = container.resolve("websites")
      const empty = await websiteService.createWebsites({
        domain: `nogsc-${Date.now()}.example.com`,
        name: "No GSC Site",
        status: "Active",
        primary_language: "en",
      })

      const res = await api.get(
        `/admin/websites/${empty.id}/analytics/search-console`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.bound).toBe(false)
      expect(res.data.synced).toBe(false)
      expect(res.data.total.clicks).toBe(0)
      expect(res.data.timeseries).toEqual([])
      expect(res.data.top_queries).toEqual([])
    })

    it("returns bound:true synced:false when binding exists but no site synced", async () => {
      const container = await getContainer()
      const websiteService = container.resolve("websites")
      const socials: any = container.resolve("socials")
      const platformId = `test-platform-nosync-${Date.now()}`

      const website = await websiteService.createWebsites({
        domain: `nosync-${Date.now()}.example.com`,
        name: "No Sync Site",
        status: "Active",
        primary_language: "en",
      })

      await socials.createSocialPlatforms({
        id: platformId,
        name: "No Sync Platform",
        category: "google",
        auth_type: "oauth2",
        status: "active",
        api_config: { test: true },
      })

      await socials.createSocialPlatformBindings({
        platform_id: platformId,
        service: "search-console",
        resource_id: `sc-domain:${website.domain}`,
        resource_label: website.domain,
        status: "active",
      })

      const res = await api.get(
        `/admin/websites/${website.id}/analytics/search-console`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      expect(res.data.bound).toBe(true)
      expect(res.data.synced).toBe(false)
      expect(res.data.binding?.resource_id).toBe(`sc-domain:${website.domain}`)
    })

    it("respects the days query parameter", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/search-console?days=7`,
        adminHeaders
      )
      expect(res.status).toBe(200)
      // 7 days of seeded data
      expect(res.data.timeseries).toHaveLength(7)
      expect(res.data.total.clicks).toBeGreaterThan(0)
    })
  })
})
