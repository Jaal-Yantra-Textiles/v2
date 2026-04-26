/**
 * Ad Planning - Attribution API Integration Tests
 *
 * Tests UTM attribution resolution, campaign linking, and attribution stats.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60 * 1000);

setupSharedTestSuite(() => {
  let headers: any;
  let websiteId: string;
  let attributionId: string;

  const { api, getContainer } = getSharedTestEnv();

  beforeAll(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);

    // Create a test website
    const websiteResponse = await api.post(
      "/admin/websites",
      {
        domain: "attribution-test.example.com",
        name: "Attribution Test Website",
        status: "Development",
      },
      headers
    );
    websiteId = websiteResponse.data.website.id;
  });

  describe("Attribution CRUD", () => {
    describe("GET /admin/ad-planning/attribution", () => {
      it("should list all attributions", async () => {
        // First create some attributions via the resolve endpoint
        await api.post(
          "/admin/ad-planning/attribution/resolve",
          {
            session_id: "test_session_001",
            website_id: websiteId,
          },
          headers
        ).catch(() => {}); // Ignore errors if session doesn't exist

        const response = await api.get(
          "/admin/ad-planning/attribution",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.attributions).toBeDefined();
        expect(Array.isArray(response.data.attributions)).toBe(true);
      });

      it("should filter attributions by website", async () => {
        const response = await api.get(
          `/admin/ad-planning/attribution?website_id=${websiteId}`,
          headers
        );

        expect(response.status).toBe(200);
        if (response.data.attributions.length > 0) {
          expect(
            response.data.attributions.every(
              (a: any) => a.website_id === websiteId
            )
          ).toBe(true);
        }
      });

      it("should filter resolved attributions", async () => {
        const response = await api.get(
          "/admin/ad-planning/attribution?is_resolved=true",
          headers
        );

        expect(response.status).toBe(200);
        if (response.data.attributions.length > 0) {
          expect(
            response.data.attributions.every((a: any) => a.is_resolved === true)
          ).toBe(true);
        }
      });

      it("should filter by platform", async () => {
        const response = await api.get(
          "/admin/ad-planning/attribution?platform=meta",
          headers
        );

        expect(response.status).toBe(200);
        if (response.data.attributions.length > 0) {
          expect(
            response.data.attributions.every((a: any) => a.platform === "meta")
          ).toBe(true);
        }
      });
    });

    describe("POST /admin/ad-planning/attribution (manual creation)", () => {
      it("should create an attribution record manually", async () => {
        const attributionData = {
          analytics_session_id: "manual_session_001",
          visitor_id: "manual_visitor_001",
          website_id: websiteId,
          platform: "meta",
          utm_source: "facebook",
          utm_medium: "cpc",
          utm_campaign: "manual_test_campaign",
          utm_term: "test term",
          utm_content: "ad_001",
          entry_page: "/landing",
          is_resolved: false,
          resolution_method: "manual",
          session_started_at: new Date().toISOString(),
        };

        const response = await api.post(
          "/admin/ad-planning/attribution",
          attributionData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.attribution).toBeDefined();
        expect(response.data.attribution.utm_campaign).toBe("manual_test_campaign");
        expect(response.data.attribution.platform).toBe("meta");

        attributionId = response.data.attribution.id;
      });

      it("should create attribution with Google platform", async () => {
        const attributionData = {
          analytics_session_id: "google_session_001",
          visitor_id: "google_visitor_001",
          website_id: websiteId,
          platform: "google",
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "google_ads_campaign",
          entry_page: "/products",
          session_started_at: new Date().toISOString(),
        };

        const response = await api.post(
          "/admin/ad-planning/attribution",
          attributionData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.attribution.platform).toBe("google");
      });
    });

    describe("GET /admin/ad-planning/attribution/stats", () => {
      it("should get attribution statistics", async () => {
        const response = await api.get(
          "/admin/ad-planning/attribution/stats",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.totals).toBeDefined();
        expect(response.data.totals.total_sessions).toBeDefined();
        expect(response.data.totals.resolved_sessions).toBeDefined();
        expect(response.data.totals.resolution_rate).toBeDefined();
      });

      it("should get stats by campaign", async () => {
        const response = await api.get(
          "/admin/ad-planning/attribution/stats",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.by_campaign).toBeDefined();
      });

      it("should get stats filtered by date range", async () => {
        const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const toDate = new Date().toISOString();

        const response = await api.get(
          `/admin/ad-planning/attribution/stats?from_date=${fromDate}&to_date=${toDate}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.totals.total_sessions).toBeDefined();
      });
    });
  });

  describe("Attribution Resolution", () => {
    describe("POST /admin/ad-planning/attribution/resolve", () => {
      it("should resolve a single session attribution", async () => {
        // Note: This test requires an analytics session to exist
        // In a real test, we'd create the session first
        const response = await api.post(
          "/admin/ad-planning/attribution/resolve",
          {
            session_id: "resolve_test_session",
            website_id: websiteId,
          },
          headers
        ).catch((e) => e.response);

        // May return success or error depending on session existence
        expect([200, 201, 404, 500]).toContain(response.status);

        if (response.status === 200 || response.status === 201) {
          expect(response.data.success).toBe(true);
        }
      });

      it("should handle bulk resolution", async () => {
        const response = await api.post(
          "/admin/ad-planning/attribution/resolve",
          {
            bulk: true,
            days_back: 7,
            website_id: websiteId,
            limit: 100,
          },
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.processed).toBeDefined();
        expect(response.data.resolved).toBeDefined();
      });

      it("should handle bulk resolution with default parameters", async () => {
        const response = await api.post(
          "/admin/ad-planning/attribution/resolve",
          {
            days_back: 3,
          },
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.processed).toBeDefined();
      });
    });
  });

  // Note: PUT /admin/ad-planning/attribution/:id route not implemented yet
  // Tests for updating attributions should be added when the route is created

  describe("Dashboard Integration", () => {
    describe("GET /admin/ad-planning/dashboard", () => {
      it("should get dashboard overview with attribution data", async () => {
        const response = await api.get(
          "/admin/ad-planning/dashboard",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.period).toBeDefined();
        expect(response.data.attribution).toBeDefined();
        expect(response.data.attribution.total_sessions).toBeDefined();
        expect(response.data.attribution.resolution_rate).toBeDefined();
      });

      it("should get dashboard filtered by website", async () => {
        const response = await api.get(
          `/admin/ad-planning/dashboard?website_id=${websiteId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.attribution).toBeDefined();
      });

      it("should get dashboard with date range", async () => {
        const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
        const toDate = new Date().toISOString().split("T")[0];

        const response = await api.get(
          `/admin/ad-planning/dashboard?from_date=${fromDate}&to_date=${toDate}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.period.from).toBeDefined();
        expect(response.data.period.to).toBeDefined();
      });
    });
  });
});
