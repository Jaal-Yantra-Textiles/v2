import { setupSharedTestSuite } from "../shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

jest.setTimeout(100000);

setupSharedTestSuite(({ api, getContainer }) => {
  describe("GET /admin/websites/:id/analytics — session metrics (#569 S1)", () => {
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
        domain: `overview-${Date.now()}.example.com`,
        name: "Overview Metrics Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;

      const analyticsService = container.resolve("custom_analytics");
      const now = new Date();

      // Seed pageview events so total_events/pageviews are non-zero.
      await analyticsService.createAnalyticsEvents([
        { website_id: websiteId, event_type: "pageview", pathname: "/", visitor_id: "v1", session_id: "s1", timestamp: now },
        { website_id: websiteId, event_type: "pageview", pathname: "/a", visitor_id: "v1", session_id: "s1", timestamp: now },
        { website_id: websiteId, event_type: "pageview", pathname: "/", visitor_id: "v2", session_id: "s2", timestamp: now },
      ]);

      // Seed sessions for the engagement metrics.
      await analyticsService.createAnalyticsSessions([
        {
          website_id: websiteId,
          session_id: "s1",
          visitor_id: "v1",
          entry_page: "/",
          pageviews: 2,
          duration_seconds: 120,
          is_bounce: false,
          started_at: now,
          last_activity_at: now,
        },
        {
          website_id: websiteId,
          session_id: "s2",
          visitor_id: "v2",
          entry_page: "/",
          pageviews: 1,
          duration_seconds: 0,
          is_bounce: true,
          started_at: now,
          last_activity_at: now,
        },
      ]);
    });

    it("includes session-derived engagement metrics in stats", async () => {
      const res = await api.get(`/admin/websites/${websiteId}/analytics`, adminHeaders);
      expect(res.status).toBe(200);

      const stats = res.data.stats;
      expect(stats.total_sessions).toBe(2);
      // 1 of 2 sessions bounced
      expect(stats.bounce_rate).toBe(0.5);
      // only s1 has duration > 0 -> avg = 120
      expect(stats.avg_session_duration).toBe(120);
      // (2 + 1) / 2 sessions = 1.5
      expect(stats.pages_per_session).toBe(1.5);
      // total pv 3 / 2 unique visitors = 1.5
      expect(stats.views_per_visitor).toBe(1.5);
    });

    it("returns zeroed session metrics for a website with no sessions", async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const empty = await websiteService.createWebsites({
        domain: `overview-empty-${Date.now()}.example.com`,
        name: "Empty Site",
        status: "Active",
        primary_language: "en",
      });

      const res = await api.get(`/admin/websites/${empty.id}/analytics`, adminHeaders);
      expect(res.status).toBe(200);
      expect(res.data.stats.total_sessions).toBe(0);
      expect(res.data.stats.bounce_rate).toBe(0);
      expect(res.data.stats.avg_session_duration).toBe(0);
      expect(res.data.stats.pages_per_session).toBe(0);
      expect(res.data.stats.views_per_visitor).toBe(0);
    });
  });
});
