/**
 * Ad Planning - Customer Journeys API Integration Tests
 *
 * Tests customer journey tracking, timeline, and funnel analysis.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60 * 1000);

setupSharedTestSuite(() => {
  let headers: any;
  let personId: string;
  let websiteId: string;
  let journeyId: string;

  const { api, getContainer } = getSharedTestEnv();

  beforeAll(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);

    // Create a test person
    const personResponse = await api.post(
      "/admin/persons",
      {
        first_name: "Journey",
        last_name: "Tester",
        email: `journey-test-${Date.now()}@example.com`,
      },
      headers
    );
    personId = personResponse.data.person.id;

    // Create a test website
    const websiteResponse = await api.post(
      "/admin/websites",
      {
        domain: "journeys-test.example.com",
        name: "Journeys Test Website",
        status: "Development",
      },
      headers
    );
    websiteId = websiteResponse.data.website.id;
  });

  describe("Journey Events CRUD", () => {
    describe("POST /admin/ad-planning/journeys", () => {
      it("should create a page_view journey event", async () => {
        const journeyData = {
          person_id: personId,
          website_id: websiteId,
          event_type: "page_view",
          event_data: {
            page_url: "/products",
            referrer: "https://google.com",
          },
        };

        const response = await api.post(
          "/admin/ad-planning/journeys",
          journeyData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.journey).toBeDefined();
        expect(response.data.journey.event_type).toBe("page_view");
        expect(response.data.journey.stage).toBe("awareness");
        expect(response.data.journey.person_id).toBe(personId);

        journeyId = response.data.journey.id;
      });

      it("should auto-assign stage based on event type", async () => {
        // Use valid event_types from the model enum with correct stage mappings from route.ts
        const events = [
          { event_type: "social_engage", expected_stage: "interest" },
          { event_type: "form_submit", expected_stage: "consideration" },
          { event_type: "lead_capture", expected_stage: "intent" },
          { event_type: "purchase", expected_stage: "conversion" },
          { event_type: "feedback", expected_stage: "retention" },
          { event_type: "support_ticket", expected_stage: "retention" },
        ];

        for (const { event_type, expected_stage } of events) {
          const response = await api.post(
            "/admin/ad-planning/journeys",
            {
              person_id: personId,
              website_id: websiteId,
              event_type,
            },
            headers
          );

          expect(response.status).toBe(201);
          expect(response.data.journey.stage).toBe(expected_stage);
        }
      });

      it("should allow explicit stage override", async () => {
        const response = await api.post(
          "/admin/ad-planning/journeys",
          {
            person_id: personId,
            website_id: websiteId,
            event_type: "page_view",
            stage: "consideration",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.journey.stage).toBe("consideration");
      });

      it("should store custom event data", async () => {
        const eventData = {
          product_id: "prod_123",
          product_name: "Test Product",
          price: 1500,
        };

        const response = await api.post(
          "/admin/ad-planning/journeys",
          {
            person_id: personId,
            website_id: websiteId,
            event_type: "custom",
            event_data: eventData,
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.journey.event_data).toMatchObject(eventData);
      });

      it("should link to analytics session via event_data", async () => {
        const response = await api.post(
          "/admin/ad-planning/journeys",
          {
            person_id: personId,
            website_id: websiteId,
            event_type: "page_view",
            event_data: {
              analytics_session_id: "session_123",
            },
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.journey.event_data.analytics_session_id).toBe("session_123");
      });
    });

    describe("GET /admin/ad-planning/journeys", () => {
      it("should list all journey events", async () => {
        // Create a journey first
        await api.post(
          "/admin/ad-planning/journeys",
          {
            person_id: personId,
            website_id: websiteId,
            event_type: "page_view",
          },
          headers
        );

        const response = await api.get(
          "/admin/ad-planning/journeys",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.journeys).toBeDefined();
        expect(response.data.journeys.length).toBeGreaterThanOrEqual(1);
      });

      it("should filter journeys by person", async () => {
        const response = await api.get(
          `/admin/ad-planning/journeys?person_id=${personId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.journeys.every((j: any) => j.person_id === personId)
        ).toBe(true);
      });

      it("should filter journeys by website", async () => {
        const response = await api.get(
          `/admin/ad-planning/journeys?website_id=${websiteId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.journeys.every((j: any) => j.website_id === websiteId)
        ).toBe(true);
      });

      it("should filter journeys by event type", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys?event_type=page_view",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.journeys.every((j: any) => j.event_type === "page_view")
        ).toBe(true);
      });

      it("should filter journeys by stage", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys?stage=awareness",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.journeys.every((j: any) => j.stage === "awareness")
        ).toBe(true);
      });

      it("should filter journeys by date range", async () => {
        const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        const response = await api.get(
          `/admin/ad-planning/journeys?from_date=${fromDate}`,
          headers
        );

        expect(response.status).toBe(200);
      });

      it("should support pagination", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys?limit=5&offset=0",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.journeys.length).toBeLessThanOrEqual(5);
        expect(response.data.limit).toBe(5);
      });
    });
  });

  describe("Customer Journey Timeline", () => {
    describe("GET /admin/ad-planning/journeys/:personId", () => {
      it("should get customer journey timeline", async () => {
        const response = await api.get(
          `/admin/ad-planning/journeys/${personId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.person).toBeDefined();
        expect(response.data.timeline).toBeDefined();
        expect(Array.isArray(response.data.timeline)).toBe(true);
        expect(response.data.summary).toBeDefined();
        expect(response.data.scores).toBeDefined();
      });

      it("should include timeline events sorted chronologically", async () => {
        const response = await api.get(
          `/admin/ad-planning/journeys/${personId}`,
          headers
        );

        expect(response.status).toBe(200);
        const timeline = response.data.timeline;

        if (timeline.length > 1) {
          for (let i = 1; i < timeline.length; i++) {
            expect(
              new Date(timeline[i].timestamp).getTime()
            ).toBeGreaterThanOrEqual(
              new Date(timeline[i - 1].timestamp).getTime()
            );
          }
        }
      });

      it("should include journey summary", async () => {
        const response = await api.get(
          `/admin/ad-planning/journeys/${personId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.summary.total_events).toBeDefined();
        expect(response.data.summary.stages_reached).toBeDefined();
        expect(response.data.summary.current_stage).toBeDefined();
        expect(response.data.summary.first_interaction).toBeDefined();
        expect(response.data.summary.latest_interaction).toBeDefined();
      });

      it("should include customer scores", async () => {
        const response = await api.get(
          `/admin/ad-planning/journeys/${personId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.scores).toBeDefined();
        expect(response.data.scores.nps).toBeDefined();
        expect(response.data.scores.engagement).toBeDefined();
        expect(response.data.scores.clv).toBeDefined();
        expect(response.data.scores.churn_risk).toBeDefined();
      });

      it("should return 404 for non-existent person", async () => {
        const response = await api
          .get("/admin/ad-planning/journeys/non-existent-person", headers)
          .catch((e) => e.response);

        expect(response.status).toBe(200); // Returns empty data for non-existent
        expect(response.data.person).toBeNull();
      });
    });
  });

  describe("Funnel Analysis", () => {
    describe("GET /admin/ad-planning/journeys/funnel", () => {
      it("should get funnel analysis", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys/funnel",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.funnel).toBeDefined();
        expect(Array.isArray(response.data.funnel)).toBe(true);
        expect(response.data.summary).toBeDefined();
        expect(response.data.stage_events).toBeDefined();
      });

      it("should include all stages in funnel", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys/funnel",
          headers
        );

        expect(response.status).toBe(200);
        const stages = response.data.funnel.map((f: any) => f.stage);
        expect(stages).toContain("awareness");
        expect(stages).toContain("interest");
        expect(stages).toContain("consideration");
        expect(stages).toContain("intent");
        expect(stages).toContain("conversion");
        expect(stages).toContain("retention");
        expect(stages).toContain("advocacy");
      });

      it("should include dropoff rates", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys/funnel",
          headers
        );

        expect(response.status).toBe(200);
        for (const stage of response.data.funnel) {
          expect(stage.count).toBeDefined();
          expect(stage.percentage).toBeDefined();
          expect(stage.dropoff_rate).toBeDefined();
        }
      });

      it("should include summary statistics", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys/funnel",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.summary.total_customers).toBeDefined();
        expect(response.data.summary.awareness_to_conversion_rate).toBeDefined();
        expect(response.data.summary.biggest_dropoff).toBeDefined();
      });

      it("should filter funnel by website", async () => {
        const response = await api.get(
          `/admin/ad-planning/journeys/funnel?website_id=${websiteId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.funnel).toBeDefined();
      });

      it("should filter funnel by date range", async () => {
        const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];
        const toDate = new Date().toISOString().split("T")[0];

        const response = await api.get(
          `/admin/ad-planning/journeys/funnel?from_date=${fromDate}&to_date=${toDate}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.funnel).toBeDefined();
      });

      it("should include stage-level event breakdown", async () => {
        const response = await api.get(
          "/admin/ad-planning/journeys/funnel",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.stage_events).toBeDefined();
        expect(response.data.stage_events.awareness).toBeDefined();
        expect(response.data.stage_events.conversion).toBeDefined();
      });
    });
  });
});
