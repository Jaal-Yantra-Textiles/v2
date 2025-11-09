import { setupSharedTestSuite } from "../shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

jest.setTimeout(100000);

setupSharedTestSuite(({ api, getContainer }) => {
  describe("Analytics Tracking E2E Flow", () => {
    let websiteId: string;
    let adminHeaders: { headers: Record<string, string> };

    beforeAll(async () => {
      // Create admin user for admin API tests
      const container = await getContainer();
      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);
    });

    beforeEach(async () => {
      // Create a test website
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const website = await websiteService.createWebsites({
        domain: "test-analytics.example.com",
        name: "Test Analytics Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;
    });

    describe("POST /web/analytics/track", () => {
      it("should track a pageview event successfully", async () => {
          const trackingData = {
            website_id: websiteId,
            event_type: "pageview",
            pathname: "/test-page",
            referrer: "https://google.com",
            visitor_id: "visitor_test_123",
            session_id: "session_test_456",
          };

          const response = await api.post(
            "/web/analytics/track",
            trackingData,
            {
              headers: {
                "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
              },
            }
          );

          expect(response.status).toBe(200);
          expect(response.data).toEqual({
            success: true,
            message: expect.any(String),
          });
        });

        it("should create an analytics event in the database", async () => {
          const trackingData = {
            website_id: websiteId,
            event_type: "pageview",
            pathname: "/products/shirt",
            referrer: "https://facebook.com",
            visitor_id: "visitor_test_789",
            session_id: "session_test_101",
          };

          await api.post("/web/analytics/track", trackingData, {
            headers: {
              "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)",
            },
          });

          // Wait a bit for async processing
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Verify event was created
          const container = await getContainer();
          const analyticsService = container.resolve("custom_analytics");
          const [events] = await analyticsService.listAndCountAnalyticsEvents({
            website_id: websiteId,
            visitor_id: "visitor_test_789",
          });

          expect(events.length).toBeGreaterThan(0);
          const event = events[0];
          expect(event.website_id).toBe(websiteId);
          expect(event.event_type).toBe("pageview");
          expect(event.pathname).toBe("/products/shirt");
          expect(event.referrer).toBe("https://facebook.com");
          expect(event.referrer_source).toBe("facebook");
          expect(event.visitor_id).toBe("visitor_test_789");
          expect(event.session_id).toBe("session_test_101");
          expect(event.device_type).toBe("mobile");
          expect(event.os).toContain("iOS");
        });

        it("should create a new session for first pageview", async () => {
          const trackingData = {
            website_id: websiteId,
            event_type: "pageview",
            pathname: "/home",
            visitor_id: "visitor_new_session",
            session_id: "session_new_123",
          };

          await api.post("/web/analytics/track", trackingData);

          // Wait for async processing
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Verify session was created
          const container = await getContainer();
          const analyticsService = container.resolve("custom_analytics");
          const [sessions] = await analyticsService.listAndCountAnalyticsSessions({
            session_id: "session_new_123",
          });

          expect(sessions.length).toBe(1);
          const session = sessions[0];
          expect(session.website_id).toBe(websiteId);
          expect(session.visitor_id).toBe("visitor_new_session");
          expect(session.entry_page).toBe("/home");
          expect(session.exit_page).toBe("/home");
          expect(session.pageviews).toBe(1);
          expect(session.is_bounce).toBe(true);
        });

        it("should update existing session for subsequent pageviews", async () => {
          const sessionId = "session_update_test";
          const visitorId = "visitor_update_test";

          // First pageview
          await api.post("/web/analytics/track", {
            website_id: websiteId,
            event_type: "pageview",
            pathname: "/page1",
            visitor_id: visitorId,
            session_id: sessionId,
          });

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Second pageview
          await api.post("/web/analytics/track", {
            website_id: websiteId,
            event_type: "pageview",
            pathname: "/page2",
            visitor_id: visitorId,
            session_id: sessionId,
          });

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Verify session was updated
          const container = await getContainer();
          const analyticsService = container.resolve("custom_analytics");
          const [sessions] = await analyticsService.listAndCountAnalyticsSessions({
            session_id: sessionId,
          });

          expect(sessions.length).toBe(1);
          const session = sessions[0];
          expect(session.entry_page).toBe("/page1");
          expect(session.exit_page).toBe("/page2");
          expect(session.pageviews).toBe(2);
          expect(session.is_bounce).toBe(false); // Not a bounce anymore
        });

        it("should track custom events", async () => {
          const trackingData = {
            website_id: websiteId,
            event_type: "custom_event",
            event_name: "button_click",
            pathname: "/signup",
            visitor_id: "visitor_custom_event",
            session_id: "session_custom_event",
            metadata: {
              button_id: "signup-cta",
              button_text: "Get Started",
            },
          };

          const response = await api.post("/web/analytics/track", trackingData);

          expect(response.status).toBe(200);

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Verify custom event
          const container = await getContainer();
          const analyticsService = container.resolve("custom_analytics");
          const [events] = await analyticsService.listAndCountAnalyticsEvents({
            website_id: websiteId,
            event_type: "custom_event",
            event_name: "button_click",
          });

          expect(events.length).toBeGreaterThan(0);
          const event = events[0];
          expect(event.event_name).toBe("button_click");
          expect(event.metadata).toEqual({
            button_id: "signup-cta",
            button_text: "Get Started",
          });
        });

        it("should parse user agent correctly", async () => {
          const testCases = [
            {
              userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/91.0",
              expectedBrowser: "Chrome",
              expectedOS: "Windows",
              expectedDevice: "desktop",
            },
            {
              userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) Safari/604.1",
              expectedBrowser: "Safari",
              expectedOS: "iOS",
              expectedDevice: "mobile",
            },
            {
              userAgent: "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) Safari/604.1",
              expectedBrowser: "Safari",
              expectedOS: "iOS",
              expectedDevice: "tablet",
            },
            {
              userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Firefox/89.0",
              expectedBrowser: "Firefox",
              expectedOS: "macOS",
              expectedDevice: "desktop",
            },
          ];

          for (const testCase of testCases) {
            const visitorId = `visitor_${Math.random().toString(36).substr(2, 9)}`;
            
            await api.post(
              "/web/analytics/track",
              {
                website_id: websiteId,
                event_type: "pageview",
                pathname: "/test",
                visitor_id: visitorId,
                session_id: `session_${visitorId}`,
              },
              {
                headers: {
                  "user-agent": testCase.userAgent,
                },
              }
            );

            await new Promise((resolve) => setTimeout(resolve, 500));

            const container = await getContainer();
            const analyticsService = container.resolve("custom_analytics");
            const [events] = await analyticsService.listAndCountAnalyticsEvents({
              visitor_id: visitorId,
            });

            expect(events.length).toBeGreaterThan(0);
            const event = events[0];
            expect(event.browser).toBe(testCase.expectedBrowser);
            expect(event.os).toBe(testCase.expectedOS);
            expect(event.device_type).toBe(testCase.expectedDevice);
          }
        });

        it("should extract referrer source correctly", async () => {
          const testCases = [
            { referrer: "https://www.google.com/search?q=test", expectedSource: "google" },
            { referrer: "https://facebook.com/page", expectedSource: "facebook" },
            { referrer: "https://twitter.com/user", expectedSource: "twitter" },
            { referrer: "https://linkedin.com/in/user", expectedSource: "linkedin" },
            { referrer: "", expectedSource: "direct" },
            { referrer: undefined, expectedSource: "direct" },
          ];

          for (const testCase of testCases) {
            const visitorId = `visitor_${Math.random().toString(36).substr(2, 9)}`;
            
            await api.post("/web/analytics/track", {
              website_id: websiteId,
              event_type: "pageview",
              pathname: "/test",
              referrer: testCase.referrer,
              visitor_id: visitorId,
              session_id: `session_${visitorId}`,
            });

            await new Promise((resolve) => setTimeout(resolve, 500));

            const container = await getContainer();
            const analyticsService = container.resolve("custom_analytics");
            const [events] = await analyticsService.listAndCountAnalyticsEvents({
              visitor_id: visitorId,
            });

            expect(events.length).toBeGreaterThan(0);
            expect(events[0].referrer_source).toBe(testCase.expectedSource);
          }
        });

        it("should handle multiple concurrent tracking requests", async () => {
          const requests = Array.from({ length: 10 }, (_, i) => ({
            website_id: websiteId,
            event_type: "pageview",
            pathname: `/page-${i}`,
            visitor_id: `visitor_concurrent_${i}`,
            session_id: `session_concurrent_${i}`,
          }));

          // Send all requests concurrently
          const responses = await Promise.all(
            requests.map((data) => api.post("/web/analytics/track", data))
          );

          // All should succeed
          responses.forEach((response) => {
            expect(response.status).toBe(200);
            expect(response.data.success).toBe(true);
          });

          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Verify all events were created
          const container = await getContainer();
          const analyticsService = container.resolve("custom_analytics");
          const [events] = await analyticsService.listAndCountAnalyticsEvents({
            website_id: websiteId,
          });

          expect(events.length).toBeGreaterThanOrEqual(10);
        });

        it("should return 200 even with invalid data (for security)", async () => {
          const invalidData = {
            website_id: "invalid_website_id",
            event_type: "pageview",
            pathname: "/test",
            visitor_id: "visitor_test",
            session_id: "session_test",
          };

          const response = await api.post("/web/analytics/track", invalidData);

          // Should still return 200 to not expose errors
          expect(response.status).toBe(200);
          expect(response.data.success).toBe(true);
        });

        it("should validate required fields", async () => {
          const incompleteData = {
            website_id: websiteId,
            // Missing required fields
          };

          const response = await api.post("/web/analytics/track", incompleteData);

          // Validation should fail but still return 200 for security
          expect(response.status).toBe(200);
        });
      });

      describe("Admin Analytics APIs", () => {
        it("should list analytics events via admin API", async () => {
          // Create some test events
          await api.post("/web/analytics/track", {
            website_id: websiteId,
            event_type: "pageview",
            pathname: "/admin-test",
            visitor_id: "visitor_admin_test",
            session_id: "session_admin_test",
          });

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Query via admin API
          const response = await api.get(
            `/admin/analytics-events?website_id=${websiteId}`,
            adminHeaders
          );

          expect(response.status).toBe(200);
          expect(response.data.analyticsEvents).toBeDefined();
          expect(Array.isArray(response.data.analyticsEvents)).toBe(true);
          expect(response.data.count).toBeGreaterThan(0);
        });

        it("should filter events by visitor_id", async () => {
          const uniqueVisitorPageview = `visitor_filter_pageview_${Date.now()}`;
          const uniqueVisitorCustom = `visitor_filter_custom_${Date.now()}`;

          // Create pageview
          await api.post("/web/analytics/track", {
            website_id: websiteId,
            event_type: "pageview",
            pathname: "/page",
            visitor_id: uniqueVisitorPageview,
            session_id: `session_${uniqueVisitorPageview}`,
          });

          // Create custom event
          await api.post("/web/analytics/track", {
            website_id: websiteId,
            event_type: "custom_event",
            event_name: "test_event",
            pathname: "/page",
            visitor_id: uniqueVisitorCustom,
            session_id: `session_${uniqueVisitorCustom}`,
          });

          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Filter by visitor_id for pageview
          const pageviewResponse = await api.get(
            `/admin/analytics-events?visitor_id=${uniqueVisitorPageview}`,
            adminHeaders
          );

          expect(pageviewResponse.data.analyticsEvents.length).toBeGreaterThan(0);
          expect(pageviewResponse.data.analyticsEvents[0].visitor_id).toBe(uniqueVisitorPageview);
          expect(pageviewResponse.data.analyticsEvents[0].event_type).toBe("pageview");

          // Filter by visitor_id for custom event
          const customResponse = await api.get(
            `/admin/analytics-events?visitor_id=${uniqueVisitorCustom}`,
            adminHeaders
          );

          expect(customResponse.data.analyticsEvents.length).toBeGreaterThan(0);
          expect(customResponse.data.analyticsEvents[0].visitor_id).toBe(uniqueVisitorCustom);
          expect(customResponse.data.analyticsEvents[0].event_type).toBe("custom_event");
          expect(customResponse.data.analyticsEvents[0].event_name).toBe("test_event");
        });
      });
    });
  },
)
