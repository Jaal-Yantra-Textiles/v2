/**
 * Ad Planning - Customer Scores API Integration Tests
 *
 * Tests NPS, engagement scoring, and score management.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60 * 1000);

setupSharedTestSuite(() => {
  let headers: any;
  let personId: string;

  const { api, getContainer } = getSharedTestEnv();

  beforeAll(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);

    // Create a test person for scoring
    const personResponse = await api.post(
      "/admin/persons",
      {
        first_name: "Score",
        last_name: "Tester",
        email: `score-test-${Date.now()}@example.com`,
        phone: "+91 98765 43210",
      },
      headers
    );
    personId = personResponse.data.person.id;
  });

  describe("NPS Scoring", () => {
    describe("POST /admin/ad-planning/scores (NPS)", () => {
      it("should calculate NPS score from 5-point rating", async () => {
        const response = await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personId,
            score_type: "nps",
            rating: 5,
            scale: "5",
            source_id: "feedback_001",
            source_type: "feedback",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.score_type).toBe("nps");
        expect(response.data.result.nps_value).toBe(10); // 5 on 5-scale = 10 on NPS scale
        expect(response.data.result.category).toBe("promoter");
      });

      it("should calculate NPS score from 10-point rating", async () => {
        const response = await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personId,
            score_type: "nps",
            rating: 7,
            scale: "10",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.result.nps_value).toBe(7);
        expect(response.data.result.category).toBe("passive");
      });

      it("should identify detractors correctly", async () => {
        // Create another person for detractor test
        const personResponse = await api.post(
          "/admin/persons",
          {
            first_name: "Detractor",
            last_name: "Test",
            email: `detractor-${Date.now()}@example.com`,
          },
          headers
        );

        const response = await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personResponse.data.person.id,
            score_type: "nps",
            rating: 2,
            scale: "5",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.result.nps_value).toBeLessThanOrEqual(6);
        expect(response.data.result.category).toBe("detractor");
      });

      it("should update existing NPS score with history", async () => {
        // First create an NPS score
        const firstResponse = await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personId,
            score_type: "nps",
            rating: 5,
            scale: "5",
          },
          headers
        );
        expect(firstResponse.status).toBe(201);

        // Submit another rating for the same person
        const response = await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personId,
            score_type: "nps",
            rating: 4,
            scale: "5",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.result.is_new).toBe(false);
        expect(response.data.result.average_score).toBeDefined();
      });

      it("should fail without rating for NPS", async () => {
        const response = await api
          .post(
            "/admin/ad-planning/scores",
            {
              person_id: personId,
              score_type: "nps",
            },
            headers
          )
          .catch((e) => e.response);

        expect(response.status).toBe(400);
        expect(response.data.error.toLowerCase()).toContain("rating");
      });
    });

    describe("GET /admin/ad-planning/nps", () => {
      it("should get overall NPS score", async () => {
        const response = await api.get("/admin/ad-planning/nps", headers);

        expect(response.status).toBe(200);
        expect(response.data.nps).toBeDefined();
        expect(response.data.nps.score).toBeDefined();
        expect(response.data.nps.promoters).toBeDefined();
        expect(response.data.nps.passives).toBeDefined();
        expect(response.data.nps.detractors).toBeDefined();
        expect(response.data.nps.total).toBeDefined();
      });

      it("should include NPS percentages", async () => {
        // Create an NPS score first
        await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personId,
            score_type: "nps",
            rating: 5,
            scale: "5",
          },
          headers
        );

        const response = await api.get("/admin/ad-planning/nps", headers);

        expect(response.status).toBe(200);
        expect(response.data.nps.promoter_percentage).toBeDefined();
        expect(response.data.nps.passive_percentage).toBeDefined();
        expect(response.data.nps.detractor_percentage).toBeDefined();
      });

      it("should include trend data", async () => {
        const response = await api.get("/admin/ad-planning/nps", headers);

        expect(response.status).toBe(200);
        expect(response.data.trend).toBeDefined();
        expect(Array.isArray(response.data.trend)).toBe(true);
      });

      it("should filter NPS by date range", async () => {
        const fromDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
          .toISOString()
          .split("T")[0];

        const response = await api.get(
          `/admin/ad-planning/nps?from_date=${fromDate}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.nps).toBeDefined();
      });
    });
  });

  describe("Engagement Scoring", () => {
    describe("POST /admin/ad-planning/scores (Engagement)", () => {
      it("should calculate engagement score", async () => {
        const response = await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personId,
            score_type: "engagement",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.score_type).toBe("engagement");
        expect(response.data.result.engagement_score).toBeDefined();
        expect(response.data.result.level).toBeDefined();
        expect(["high", "medium", "low", "inactive"]).toContain(
          response.data.result.level
        );
      });

      it("should include activity breakdown", async () => {
        const response = await api.post(
          "/admin/ad-planning/scores",
          {
            person_id: personId,
            score_type: "engagement",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.result.breakdown).toBeDefined();
        expect(response.data.result.total_activities).toBeDefined();
      });

      it("should track score changes", async () => {
        // Calculate twice to get score change
        await api.post(
          "/admin/ad-planning/scores",
          { person_id: personId, score_type: "engagement" },
          headers
        );

        const response = await api.post(
          "/admin/ad-planning/scores",
          { person_id: personId, score_type: "engagement" },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.result.is_new).toBe(false);
        expect(response.data.result.previous_score).toBeDefined();
      });
    });
  });

  describe("Score Listing", () => {
    describe("GET /admin/ad-planning/scores", () => {
      it("should list all scores", async () => {
        const response = await api.get("/admin/ad-planning/scores", headers);

        expect(response.status).toBe(200);
        expect(response.data.scores).toBeDefined();
        expect(response.data.aggregates).toBeDefined();
      });

      it("should filter scores by person", async () => {
        const response = await api.get(
          `/admin/ad-planning/scores?person_id=${personId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.scores.every((s: any) => s.person_id === personId)
        ).toBe(true);
      });

      it("should filter scores by type", async () => {
        const response = await api.get(
          "/admin/ad-planning/scores?score_type=nps",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.scores.every((s: any) => s.score_type === "nps")
        ).toBe(true);
      });

      it("should include aggregates by score type", async () => {
        const response = await api.get("/admin/ad-planning/scores", headers);

        expect(response.status).toBe(200);
        if (response.data.aggregates.nps) {
          expect(response.data.aggregates.nps.count).toBeDefined();
          expect(response.data.aggregates.nps.avg).toBeDefined();
        }
        if (response.data.aggregates.engagement) {
          expect(response.data.aggregates.engagement.count).toBeDefined();
          expect(response.data.aggregates.engagement.avg).toBeDefined();
        }
      });

      it("should support pagination", async () => {
        const response = await api.get(
          "/admin/ad-planning/scores?limit=5&offset=0",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.scores.length).toBeLessThanOrEqual(5);
        expect(response.data.limit).toBe(5);
      });
    });
  });
});
