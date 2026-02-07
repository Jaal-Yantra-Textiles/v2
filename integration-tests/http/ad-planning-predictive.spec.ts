/**
 * Ad Planning - Predictive Analytics API Integration Tests
 *
 * Tests churn risk prediction, CLV calculation, and at-risk customer identification.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(90 * 1000); // Longer timeout for predictive calculations

setupSharedTestSuite(() => {
  let headers: any;
  let personId: string;
  let websiteId: string;

  const { api, getContainer } = getSharedTestEnv();

  beforeAll(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);

    // Create a test person
    const personResponse = await api.post(
      "/admin/persons",
      {
        first_name: "Predictive",
        last_name: "Tester",
        email: `predictive-test-${Date.now()}@example.com`,
      },
      headers
    );
    personId = personResponse.data.person.id;

    // Create a test website
    const websiteResponse = await api.post(
      "/admin/websites",
      {
        domain: "predictive-test.example.com",
        name: "Predictive Test Website",
        status: "Development",
      },
      headers
    );
    websiteId = websiteResponse.data.website.id;

    // Create some test data for the person
    // Create conversions (visitor_id is required)
    await api.post(
      "/admin/ad-planning/conversions",
      {
        conversion_type: "purchase",
        person_id: personId,
        website_id: websiteId,
        conversion_value: 2500,
        currency: "INR",
        visitor_id: `pred_visitor_${Date.now()}_1`,
      },
      headers
    );

    await api.post(
      "/admin/ad-planning/conversions",
      {
        conversion_type: "purchase",
        person_id: personId,
        website_id: websiteId,
        conversion_value: 3500,
        currency: "INR",
        visitor_id: `pred_visitor_${Date.now()}_2`,
      },
      headers
    );

    // Create journey events
    await api.post(
      "/admin/ad-planning/journeys",
      {
        person_id: personId,
        website_id: websiteId,
        event_type: "page_view",
      },
      headers
    );

    await api.post(
      "/admin/ad-planning/journeys",
      {
        person_id: personId,
        website_id: websiteId,
        event_type: "purchase",
      },
      headers
    );
  });

  describe("Churn Risk Prediction", () => {
    describe("POST /admin/ad-planning/predictive (churn_risk)", () => {
      it("should calculate churn risk for a customer", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "churn_risk",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.person_id).toBe(personId);
        expect(response.data.predictions.churn_risk).toBeDefined();
        expect(response.data.predictions.churn_risk.churn_risk_score).toBeDefined();
        expect(response.data.predictions.churn_risk.risk_level).toBeDefined();
        expect(["low", "medium", "high", "critical"]).toContain(
          response.data.predictions.churn_risk.risk_level
        );
      });

      it("should include contributing factors", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "churn_risk",
          },
          headers
        );

        expect(response.status).toBe(201);
        const churnData = response.data.predictions.churn_risk;
        expect(churnData.contributing_factors).toBeDefined();
        expect(churnData.contributing_factors.activity_risk).toBeDefined();
        expect(churnData.contributing_factors.purchase_risk).toBeDefined();
        expect(churnData.contributing_factors.engagement_risk).toBeDefined();
      });

      it("should include recommendations", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "churn_risk",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.predictions.churn_risk.recommendations).toBeDefined();
        expect(
          Array.isArray(response.data.predictions.churn_risk.recommendations)
        ).toBe(true);
      });

      it("should track prediction history", async () => {
        // Calculate twice
        await api.post(
          "/admin/ad-planning/predictive",
          { person_id: personId, prediction_type: "churn_risk" },
          headers
        );

        const response = await api.post(
          "/admin/ad-planning/predictive",
          { person_id: personId, prediction_type: "churn_risk" },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.predictions.churn_risk.is_new).toBe(false);
        // previous_score should be present (may be null or a number)
        expect("previous_score" in response.data.predictions.churn_risk).toBe(true);
      });
    });
  });

  describe("Customer Lifetime Value", () => {
    describe("POST /admin/ad-planning/predictive (clv)", () => {
      it("should calculate CLV for a customer", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "clv",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.person_id).toBe(personId);
        expect(response.data.predictions.clv).toBeDefined();
        expect(response.data.predictions.clv.predicted_clv).toBeDefined();
        expect(response.data.predictions.clv.realized_clv).toBeDefined();
        expect(response.data.predictions.clv.remaining_clv).toBeDefined();
      });

      it("should assign customer tier", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "clv",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.predictions.clv.tier).toBeDefined();
        expect(["platinum", "gold", "silver", "bronze"]).toContain(
          response.data.predictions.clv.tier
        );
      });

      it("should include confidence level", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "clv",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.predictions.clv.confidence).toBeDefined();
        expect(["high", "medium", "low"]).toContain(
          response.data.predictions.clv.confidence
        );
      });

      it("should include purchase metrics", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "clv",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.predictions.clv.metrics).toBeDefined();
        expect(
          response.data.predictions.clv.metrics.average_order_value
        ).toBeDefined();
        expect(
          response.data.predictions.clv.metrics.monthly_frequency
        ).toBeDefined();
        expect(
          response.data.predictions.clv.metrics.purchase_count
        ).toBeDefined();
      });
    });
  });

  describe("Combined Predictions", () => {
    describe("POST /admin/ad-planning/predictive (all)", () => {
      it("should calculate all predictions at once", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "all",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.predictions.churn_risk).toBeDefined();
        expect(response.data.predictions.clv).toBeDefined();
      });

      it("should return consistent person_id", async () => {
        const response = await api.post(
          "/admin/ad-planning/predictive",
          {
            person_id: personId,
            prediction_type: "all",
          },
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.person_id).toBe(personId);
        expect(response.data.predictions.churn_risk.person_id).toBe(personId);
        expect(response.data.predictions.clv.person_id).toBe(personId);
      });
    });
  });

  describe("Prediction Listing", () => {
    describe("GET /admin/ad-planning/predictive", () => {
      it("should list all predictions", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.predictions).toBeDefined();
        expect(response.data.summary).toBeDefined();
      });

      it("should filter predictions by person", async () => {
        const response = await api.get(
          `/admin/ad-planning/predictive?person_id=${personId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.predictions.every((p: any) => p.person_id === personId)
        ).toBe(true);
      });

      it("should filter predictions by score type", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive?score_type=churn_risk",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.predictions.every(
            (p: any) => p.score_type === "churn_risk"
          )
        ).toBe(true);
      });

      it("should filter by risk level", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive?risk_level=low",
          headers
        );

        expect(response.status).toBe(200);
        // May be empty if no low-risk customers exist
      });

      it("should filter by tier", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive?tier=bronze",
          headers
        );

        expect(response.status).toBe(200);
        // May be empty if no bronze tier customers exist
      });

      it("should include summary statistics", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.summary.churn_risk).toBeDefined();
        expect(response.data.summary.churn_risk.by_level).toBeDefined();
        expect(response.data.summary.clv).toBeDefined();
        expect(response.data.summary.clv.by_tier).toBeDefined();
      });

      it("should support pagination", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive?limit=5&offset=0",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.predictions.length).toBeLessThanOrEqual(5);
        expect(response.data.limit).toBe(5);
      });
    });
  });

  describe("At-Risk Customers", () => {
    describe("GET /admin/ad-planning/predictive/at-risk", () => {
      it("should list at-risk customers", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive/at-risk",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.at_risk_customers).toBeDefined();
        expect(Array.isArray(response.data.at_risk_customers)).toBe(true);
        expect(response.data.summary).toBeDefined();
      });

      it("should filter by minimum risk score", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive/at-risk?min_risk_score=30",
          headers
        );

        expect(response.status).toBe(200);
        for (const customer of response.data.at_risk_customers) {
          expect(customer.churn_risk.score).toBeGreaterThanOrEqual(30);
        }
      });

      it("should include customer details", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive/at-risk?min_risk_score=0",
          headers
        );

        expect(response.status).toBe(200);
        if (response.data.at_risk_customers.length > 0) {
          const customer = response.data.at_risk_customers[0];
          expect(customer.person_id).toBeDefined();
          expect(customer.churn_risk).toBeDefined();
          expect(customer.churn_risk.score).toBeDefined();
          expect(customer.churn_risk.level).toBeDefined();
          expect(customer.priority).toBeDefined();
        }
      });

      it("should include CLV data when available", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive/at-risk?min_risk_score=0",
          headers
        );

        expect(response.status).toBe(200);
        if (response.data.at_risk_customers.length > 0) {
          const customer = response.data.at_risk_customers[0];
          expect(customer.clv).toBeDefined();
        }
      });

      it("should include summary statistics", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive/at-risk",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.summary.total_at_risk).toBeDefined();
        expect(response.data.summary.critical_count).toBeDefined();
        expect(response.data.summary.high_value_at_risk).toBeDefined();
        expect(response.data.summary.potential_revenue_at_risk).toBeDefined();
      });

      it("should prioritize high-value at-risk customers", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive/at-risk?min_risk_score=0",
          headers
        );

        expect(response.status).toBe(200);
        const customers = response.data.at_risk_customers;

        // High-value at-risk should be first
        const highValueIndex = customers.findIndex(
          (c: any) => c.priority === "high_value_at_risk"
        );
        const criticalIndex = customers.findIndex(
          (c: any) => c.priority === "critical"
        );
        const standardIndex = customers.findIndex(
          (c: any) => c.priority === "standard"
        );

        if (highValueIndex !== -1 && criticalIndex !== -1) {
          expect(highValueIndex).toBeLessThan(criticalIndex);
        }
        if (criticalIndex !== -1 && standardIndex !== -1) {
          expect(criticalIndex).toBeLessThan(standardIndex);
        }
      });

      it("should limit results", async () => {
        const response = await api.get(
          "/admin/ad-planning/predictive/at-risk?limit=5",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.at_risk_customers.length).toBeLessThanOrEqual(5);
      });
    });
  });
});
