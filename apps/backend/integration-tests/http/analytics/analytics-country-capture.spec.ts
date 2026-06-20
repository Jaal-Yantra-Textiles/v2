import { setupSharedTestSuite } from "../shared-test-setup";

jest.setTimeout(100000);

/**
 * #559 slice 6 — browser-side country capture.
 *
 * The client now sends its IANA `timezone` (+ `locale`); the backend derives the
 * event country by precedence: explicit client `country` → timezone-derived →
 * GeoIP-of-IP. Locale is carried into immutable event metadata.
 */
setupSharedTestSuite(({ api, getContainer }) => {
  describe("Analytics browser country capture (#559 slice 6)", () => {
    let websiteId: string;

    beforeEach(async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const website = await websiteService.createWebsites({
        domain: "test-country-capture.example.com",
        name: "Country Capture Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;
    });

    async function lastEvent(visitorId: string) {
      const container = await getContainer();
      const analyticsService = container.resolve("custom_analytics");
      const [events] = await analyticsService.listAndCountAnalyticsEvents({
        website_id: websiteId,
        visitor_id: visitorId,
      });
      return events[0];
    }

    it("derives country from the browser timezone and stores locale in metadata", async () => {
      const res = await api.post("/web/analytics/track", {
        website_id: websiteId,
        event_type: "pageview",
        pathname: "/tz-page",
        visitor_id: "visitor_tz_in",
        session_id: "session_tz_in",
        timezone: "Asia/Kolkata",
        locale: "en-IN",
      });
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 1000));
      const event = await lastEvent("visitor_tz_in");
      expect(event).toBeDefined();
      expect(event.country).toBe("IN");
      expect(event.metadata?.locale).toBe("en-IN");
    });

    it("prefers an explicit client country over the timezone", async () => {
      const res = await api.post("/web/analytics/track", {
        website_id: websiteId,
        event_type: "pageview",
        pathname: "/explicit-country",
        visitor_id: "visitor_explicit",
        session_id: "session_explicit",
        country: "FR",
        timezone: "Asia/Kolkata",
        locale: "fr-FR",
      });
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 1000));
      const event = await lastEvent("visitor_explicit");
      expect(event.country).toBe("FR");
    });

    it("leaves country null when timezone is unknown and no GeoIP match (local IP)", async () => {
      const res = await api.post("/web/analytics/track", {
        website_id: websiteId,
        event_type: "pageview",
        pathname: "/unknown-tz",
        visitor_id: "visitor_unknown_tz",
        session_id: "session_unknown_tz",
        timezone: "Mars/Phobos",
      });
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 1000));
      const event = await lastEvent("visitor_unknown_tz");
      expect(event).toBeDefined();
      expect(event.country).toBeNull();
    });

    it("derives session country from the timezone too", async () => {
      await api.post("/web/analytics/track", {
        website_id: websiteId,
        event_type: "pageview",
        pathname: "/session-tz",
        visitor_id: "visitor_session_tz",
        session_id: "session_country_tz",
        timezone: "Europe/London",
      });

      await new Promise((r) => setTimeout(r, 1000));
      const container = await getContainer();
      const analyticsService = container.resolve("custom_analytics");
      const [sessions] = await analyticsService.listAndCountAnalyticsSessions({
        session_id: "session_country_tz",
      });
      expect(sessions.length).toBe(1);
      expect(sessions[0].country).toBe("GB");
    });
  });
});
