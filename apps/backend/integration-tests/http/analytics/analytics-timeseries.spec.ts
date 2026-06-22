import { setupSharedTestSuite } from "../shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

jest.setTimeout(100000);

/**
 * #569 S8 — timeseries endpoint regression guard.
 *
 * The timeseries workflow receives its `start_date`/`end_date` as JSON-
 * serialized ISO strings (workflow durability). The fill-loop previously
 * compared `Date <= string` (→ NaN), so it never ran and the endpoint returned
 * ZERO buckets even when events existed. These tests lock in that the range is
 * filled and event counts land in the correct interval bucket.
 */
setupSharedTestSuite(({ api, getContainer }) => {
  describe("GET /admin/analytics-events/timeseries (#569 S8)", () => {
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
        domain: `ts-${Date.now()}.example.com`,
        name: "Timeseries Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;

      const analyticsService = container.resolve("custom_analytics");
      const now = new Date();
      await analyticsService.createAnalyticsEvents([
        { website_id: websiteId, event_type: "pageview", pathname: "/", visitor_id: "v1", session_id: "s1", timestamp: now },
        { website_id: websiteId, event_type: "pageview", pathname: "/a", visitor_id: "v1", session_id: "s1", timestamp: now },
        { website_id: websiteId, event_type: "pageview", pathname: "/", visitor_id: "v2", session_id: "s2", timestamp: now },
        { website_id: websiteId, event_type: "custom_event", event_name: "link_out", pathname: "/", visitor_id: "v2", session_id: "s2", timestamp: now },
      ]);
    });

    it("fills daily buckets across the window and counts events in today's bucket", async () => {
      const res = await api.get(
        `/admin/analytics-events/timeseries?website_id=${websiteId}&days=7&interval=day`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.period.interval).toBe("day");

      // Regression guard: the fill-loop must run, so the range is NOT empty.
      const buckets = res.data.data;
      expect(Array.isArray(buckets)).toBe(true);
      expect(buckets.length).toBeGreaterThan(1);

      // The 3 pageviews + 1 custom event land in a single (today's) bucket.
      const nonzero = buckets.filter(
        (b: any) => b.pageviews > 0 || b.custom_events > 0
      );
      expect(nonzero.length).toBe(1);
      expect(nonzero[0]).toMatchObject({
        pageviews: 3,
        custom_events: 1,
        total_events: 4,
        unique_visitors: 2,
        unique_sessions: 2,
      });
    });

    it("fills hourly buckets across a 24h window", async () => {
      const res = await api.get(
        `/admin/analytics-events/timeseries?website_id=${websiteId}&days=1&interval=hour`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.period.interval).toBe("hour");

      const buckets = res.data.data;
      expect(buckets.length).toBeGreaterThan(1);
      const nonzero = buckets.filter(
        (b: any) => b.pageviews > 0 || b.custom_events > 0
      );
      expect(nonzero.length).toBe(1);
      expect(nonzero[0].pageviews).toBe(3);
    });

    it("returns zero-filled buckets (not an empty array) for a site with no events", async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const empty = await websiteService.createWebsites({
        domain: `ts-empty-${Date.now()}.example.com`,
        name: "Empty Timeseries Site",
        status: "Active",
        primary_language: "en",
      });

      const res = await api.get(
        `/admin/analytics-events/timeseries?website_id=${empty.id}&days=7&interval=day`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.data.length).toBeGreaterThan(1);
      expect(
        res.data.data.every((b: any) => b.total_events === 0)
      ).toBe(true);
    });

    it("400s when website_id is missing", async () => {
      const res = await api
        .get(`/admin/analytics-events/timeseries?days=7`, adminHeaders)
        .catch((e: any) => e.response);
      expect(res.status).toBe(400);
    });
  });
});
