import { setupSharedTestSuite } from "../shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

jest.setTimeout(100000);

setupSharedTestSuite(({ api, getContainer }) => {
  describe("GET /admin/websites/:id/analytics/sessions (#569 S7a)", () => {
    let websiteId: string;
    let adminHeaders: { headers: Record<string, string> };

    beforeAll(async () => {
      const container = await getContainer();
      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);
    });

    beforeEach(async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const website = await websiteService.createWebsites({
        domain: `sessions-${Date.now()}.example.com`,
        name: "Sessions Test Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;

      const analyticsService = container.resolve("custom_analytics");
      const base = Date.now();
      // 5 sessions with increasing pageviews + started_at so ordering is testable.
      const rows = Array.from({ length: 5 }).map((_, i) => ({
        website_id: websiteId,
        session_id: `${websiteId}-s${i}`,
        visitor_id: `v${i}`,
        entry_page: `/entry-${i}`,
        exit_page: `/exit-${i}`,
        pageviews: i + 1,
        duration_seconds: (i + 1) * 10,
        is_bounce: i === 0,
        country: i % 2 === 0 ? "IN" : "US",
        started_at: new Date(base + i * 1000),
        last_activity_at: new Date(base + i * 1000 + 500),
      }));
      await analyticsService.createAnalyticsSessions(rows);
    });

    it("returns sessions with count, defaulting to DESC started_at and limit 20", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/sessions`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.website_id).toBe(websiteId);
      expect(res.data.count).toBe(5);
      expect(res.data.limit).toBe(20);
      expect(res.data.offset).toBe(0);
      expect(res.data.sessions).toHaveLength(5);
      // newest first → highest index (latest started_at) first
      expect(res.data.sessions[0].session_id).toBe(`${websiteId}-s4`);
      // projection exposes summary fields
      expect(res.data.sessions[0]).toHaveProperty("entry_page");
      expect(res.data.sessions[0]).toHaveProperty("pageviews");
    });

    it("paginates via limit/offset and reports the full count", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/sessions?limit=2&offset=2`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.count).toBe(5);
      expect(res.data.limit).toBe(2);
      expect(res.data.offset).toBe(2);
      expect(res.data.sessions).toHaveLength(2);
    });

    it("orders by a whitelisted column ascending", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/sessions?order_by=pageviews&order_dir=ASC`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      const pvs = res.data.sessions.map((s: any) => s.pageviews);
      expect(pvs).toEqual([1, 2, 3, 4, 5]);
    });

    it("returns an empty page for an unknown website (best-effort, no throw)", async () => {
      const res = await api.get(
        `/admin/websites/web_does_not_exist/analytics/sessions`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.count).toBe(0);
      expect(res.data.sessions).toEqual([]);
    });
  });
});
