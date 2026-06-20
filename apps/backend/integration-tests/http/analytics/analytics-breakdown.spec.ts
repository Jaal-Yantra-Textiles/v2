import { setupSharedTestSuite } from "../shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

jest.setTimeout(100000);

setupSharedTestSuite(({ api, getContainer }) => {
  describe("GET /admin/analytics-events/breakdown (#559 slice 3)", () => {
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
        domain: `breakdown-${Date.now()}.example.com`,
        name: "Breakdown Test Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;

      // Seed events directly via the analytics service for deterministic data.
      const analyticsService = container.resolve("custom_analytics");
      const now = new Date();
      const rows = [
        { country: "IN", device_type: "mobile", pathname: "/home", visitor_id: "v1" },
        { country: "IN", device_type: "desktop", pathname: "/home", visitor_id: "v2" },
        { country: "US", device_type: "desktop", pathname: "/about", visitor_id: "v3" },
        { country: "US", device_type: "mobile", pathname: "/home", visitor_id: "v3" },
        { country: null, device_type: "unknown", pathname: "/404", visitor_id: "v4" },
      ];
      await analyticsService.createAnalyticsEvents(
        rows.map((r, i) => ({
          website_id: websiteId,
          event_type: "pageview",
          pathname: r.pathname,
          visitor_id: r.visitor_id,
          session_id: `s${i}`,
          country: r.country,
          device_type: r.device_type,
          timestamp: now,
        }))
      );
    });

    it("400s when website_id is missing", async () => {
      const res = await api
        .get("/admin/analytics-events/breakdown?dimension=country", adminHeaders)
        .catch((e) => e.response);
      expect(res.status).toBe(400);
    });

    it("400s when dimension is missing or unknown", async () => {
      const missing = await api
        .get(`/admin/analytics-events/breakdown?website_id=${websiteId}`, adminHeaders)
        .catch((e) => e.response);
      expect(missing.status).toBe(400);

      const unknown = await api
        .get(`/admin/analytics-events/breakdown?website_id=${websiteId}&dimension=visitor_id`, adminHeaders)
        .catch((e) => e.response);
      expect(unknown.status).toBe(400);
      expect(unknown.data.supported_dimensions).toContain("country");
    });

    it("breaks down by country with counts and unique visitors", async () => {
      const res = await api.get(
        `/admin/analytics-events/breakdown?website_id=${websiteId}&dimension=country`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.dimension).toBe("country");
      expect(res.data.breakdown.total_events).toBe(5);

      const byValue = Object.fromEntries(
        res.data.breakdown.results.map((r: any) => [r.value, r])
      );
      expect(byValue["IN"].count).toBe(2);
      expect(byValue["US"].count).toBe(2);
      // null country bucketed under "unknown"
      expect(byValue["unknown"].count).toBe(1);
    });

    it("breaks down by pathname", async () => {
      const res = await api.get(
        `/admin/analytics-events/breakdown?website_id=${websiteId}&dimension=pathname`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      const home = res.data.breakdown.results.find((r: any) => r.value === "/home");
      expect(home.count).toBe(3);
    });

    it("applies a composable equality filter", async () => {
      const res = await api.get(
        `/admin/analytics-events/breakdown?website_id=${websiteId}&dimension=country&device_type=desktop`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.filters.device_type).toBe("desktop");
      expect(res.data.breakdown.total_events).toBe(2);
      const byValue = Object.fromEntries(
        res.data.breakdown.results.map((r: any) => [r.value, r.count])
      );
      expect(byValue["IN"]).toBe(1);
      expect(byValue["US"]).toBe(1);
    });

    it("respects the limit parameter", async () => {
      const res = await api.get(
        `/admin/analytics-events/breakdown?website_id=${websiteId}&dimension=pathname&limit=1`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.breakdown.results).toHaveLength(1);
      // most frequent pathname wins
      expect(res.data.breakdown.results[0].value).toBe("/home");
    });
  });
});
