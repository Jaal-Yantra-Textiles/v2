import { setupSharedTestSuite } from "../shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

jest.setTimeout(100000);

setupSharedTestSuite(({ api, getContainer }) => {
  describe("GET /admin/websites/:id/analytics/outbound — outbound links (#569 S5a)", () => {
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
        domain: `outbound-${Date.now()}.example.com`,
        name: "Outbound Links Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;

      const analyticsService = container.resolve("custom_analytics");
      const now = new Date();

      const mk = (visitor: string, href: string | null) => ({
        website_id: websiteId,
        event_type: "custom_event" as const,
        event_name: "link_out",
        pathname: "/",
        visitor_id: visitor,
        session_id: `sess_${visitor}`,
        timestamp: now,
        metadata: href ? { href } : null,
      });

      await analyticsService.createAnalyticsEvents([
        mk("v1", "https://partner.example.com/a"),
        mk("v2", "https://partner.example.com/a"),
        mk("v1", "https://partner.example.com/a"),
        mk("v3", "https://other.example.com/b"),
        // A non-link_out event must be ignored entirely.
        {
          website_id: websiteId,
          event_type: "pageview" as const,
          pathname: "/",
          visitor_id: "v9",
          session_id: "sess_v9",
          timestamp: now,
        },
      ]);
    });

    it("returns ranked outbound links grouped by href", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/outbound`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.website_id).toBe(websiteId);

      const ol = res.data.outbound_links;
      // 4 link_out events; the pageview is excluded
      expect(ol.total_events).toBe(4);
      expect(ol.total_unique_visitors).toBe(3); // v1,v2,v3

      expect(ol.results[0]).toMatchObject({
        value: "https://partner.example.com/a",
        count: 3,
        unique_visitors: 2,
        percentage: 75,
      });
      expect(ol.results[1]).toMatchObject({
        value: "https://other.example.com/b",
        count: 1,
      });
    });

    it("respects the limit query param", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/outbound?limit=1`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.outbound_links.results).toHaveLength(1);
      expect(res.data.outbound_links.total_events).toBe(4);
    });

    it("returns a zeroed result for a website with no outbound events", async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const empty = await websiteService.createWebsites({
        domain: `outbound-empty-${Date.now()}.example.com`,
        name: "Empty Outbound Site",
        status: "Active",
        primary_language: "en",
      });

      const res = await api.get(
        `/admin/websites/${empty.id}/analytics/outbound`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.outbound_links.total_events).toBe(0);
      expect(res.data.outbound_links.results).toEqual([]);
    });
  });
});
