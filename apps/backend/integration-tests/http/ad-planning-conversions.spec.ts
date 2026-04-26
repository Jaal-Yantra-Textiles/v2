/**
 * Ad Planning - Conversions API Integration Tests
 *
 * Tests conversion tracking, conversion goals, and the conversion workflow.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60 * 1000);

setupSharedTestSuite(() => {
  let headers: any;
  let websiteId: string;
  let conversionGoalId: string;
  let conversionId: string;

  const { api, getContainer } = getSharedTestEnv();

  beforeAll(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);

    // Create a test website for conversions
    const websiteResponse = await api.post(
      "/admin/websites",
      {
        domain: "conversions-test.example.com",
        name: "Conversions Test Website",
        status: "Development",
      },
      headers
    );
    websiteId = websiteResponse.data.website.id;
  });

  describe("Conversion Goals CRUD", () => {
    describe("POST /admin/ad-planning/goals", () => {
      it("should create a conversion goal", async () => {
        const goalData = {
          name: "Purchase Conversion",
          description: "Track all purchase conversions",
          goal_type: "purchase",
          conditions: {},
          default_value: 50000,
          website_id: websiteId,
          is_active: true,
        };

        const response = await api.post(
          "/admin/ad-planning/goals",
          goalData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.goal).toBeDefined();
        expect(response.data.goal.name).toBe(goalData.name);
        expect(response.data.goal.goal_type).toBe(goalData.goal_type);
        expect(response.data.goal.is_active).toBe(true);

        conversionGoalId = response.data.goal.id;
      });

      it("should create a lead form conversion goal", async () => {
        const goalData = {
          name: "Lead Form Submissions",
          goal_type: "lead_form",
          conditions: {},
          website_id: websiteId,
        };

        const response = await api.post(
          "/admin/ad-planning/goals",
          goalData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.goal.goal_type).toBe("lead_form");
      });

      it("should create a custom conversion goal", async () => {
        const goalData = {
          name: "Newsletter Signup",
          goal_type: "custom_event",
          conditions: {
            event_name: "newsletter_signup",
          },
          website_id: websiteId,
        };

        const response = await api.post(
          "/admin/ad-planning/goals",
          goalData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.goal.goal_type).toBe("custom_event");
        expect(response.data.goal.conditions.event_name).toBe("newsletter_signup");
      });
    });

    describe("GET /admin/ad-planning/goals", () => {
      it("should list all conversion goals", async () => {
        // Create a goal first
        await api.post(
          "/admin/ad-planning/goals",
          {
            name: "Goal for List Test",
            goal_type: "purchase",
            conditions: {},
          },
          headers
        );

        const response = await api.get(
          "/admin/ad-planning/goals",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.goals).toBeDefined();
        expect(response.data.goals.length).toBeGreaterThanOrEqual(1);
      });

      it("should filter goals by type", async () => {
        const response = await api.get(
          "/admin/ad-planning/goals?goal_type=purchase",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.goals.every((g: any) => g.goal_type === "purchase")
        ).toBe(true);
      });

      it("should filter active goals only", async () => {
        const response = await api.get(
          "/admin/ad-planning/goals?is_active=true",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.goals.every((g: any) => g.is_active === true)
        ).toBe(true);
      });
    });

    describe("GET /admin/ad-planning/goals/:id", () => {
      it("should get a specific conversion goal", async () => {
        // Create a goal first
        const createResponse = await api.post(
          "/admin/ad-planning/goals",
          {
            name: "Goal for Get Test",
            goal_type: "purchase",
            conditions: {},
          },
          headers
        );
        const testGoalId = createResponse.data.goal.id;

        const response = await api.get(
          `/admin/ad-planning/goals/${testGoalId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.goal).toBeDefined();
        expect(response.data.goal.id).toBe(testGoalId);
      });

      it("should return 404 for non-existent goal", async () => {
        const response = await api
          .get("/admin/ad-planning/goals/non-existent-id", headers)
          .catch((e) => e.response);

        expect(response.status).toBe(404);
      });
    });

    describe("PUT /admin/ad-planning/goals/:id", () => {
      it("should update a conversion goal", async () => {
        // Create a goal first
        const createResponse = await api.post(
          "/admin/ad-planning/goals",
          {
            name: "Goal for Update Test",
            goal_type: "purchase",
            conditions: {},
          },
          headers
        );
        const testGoalId = createResponse.data.goal.id;

        const updateData = {
          name: "Updated Purchase Goal",
          default_value: 75000,
        };

        const response = await api.put(
          `/admin/ad-planning/goals/${testGoalId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.goal.name).toBe(updateData.name);
      });

      it("should deactivate a conversion goal", async () => {
        // Create a goal first
        const createResponse = await api.post(
          "/admin/ad-planning/goals",
          {
            name: "Goal for Deactivate Test",
            goal_type: "purchase",
            conditions: {},
            is_active: true,
          },
          headers
        );
        const testGoalId = createResponse.data.goal.id;

        const response = await api.put(
          `/admin/ad-planning/goals/${testGoalId}`,
          { is_active: false },
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.goal.is_active).toBe(false);
      });
    });
  });

  describe("Conversions CRUD", () => {
    describe("POST /admin/ad-planning/conversions", () => {
      it("should create a purchase conversion", async () => {
        const conversionData = {
          conversion_type: "purchase",
          website_id: websiteId,
          conversion_value: 1500,
          currency: "INR",
          visitor_id: "visitor_123",
          session_id: "session_456",
          utm_source: "facebook",
          utm_medium: "cpc",
          utm_campaign: "summer_sale",
          metadata: {
            landing_page: "/products",
            conversion_page: "/checkout/success",
          },
        };

        const response = await api.post(
          "/admin/ad-planning/conversions",
          conversionData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.conversion).toBeDefined();
        expect(response.data.conversion.conversion_type).toBe("purchase");
        expect(response.data.conversion.conversion_value).toBe(1500);
        expect(response.data.conversion.utm_campaign).toBe("summer_sale");

        conversionId = response.data.conversion.id;
      });

      it("should create a lead form conversion", async () => {
        const conversionData = {
          conversion_type: "lead_form_submission",
          website_id: websiteId,
          visitor_id: "visitor_789",
          utm_source: "google",
          utm_medium: "organic",
          metadata: {
            form_id: "form_contact",
          },
        };

        const response = await api.post(
          "/admin/ad-planning/conversions",
          conversionData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.conversion.conversion_type).toBe("lead_form_submission");
        expect(response.data.conversion.metadata.form_id).toBe("form_contact");
      });

      it("should create an add_to_cart conversion", async () => {
        const conversionData = {
          conversion_type: "add_to_cart",
          website_id: websiteId,
          conversion_value: 500,
          visitor_id: "visitor_111",
          metadata: {
            product_id: "prod_123",
          },
        };

        const response = await api.post(
          "/admin/ad-planning/conversions",
          conversionData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.conversion.conversion_type).toBe("add_to_cart");
        expect(response.data.conversion.metadata.product_id).toBe("prod_123");
      });
    });

    describe("GET /admin/ad-planning/conversions", () => {
      it("should list all conversions", async () => {
        // Create a conversion first
        await api.post(
          "/admin/ad-planning/conversions",
          {
            conversion_type: "page_engagement",
            website_id: websiteId,
            visitor_id: "list_test_visitor",
          },
          headers
        );

        const response = await api.get(
          "/admin/ad-planning/conversions",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.conversions).toBeDefined();
        expect(response.data.conversions.length).toBeGreaterThanOrEqual(1);
        expect(response.data.count).toBeGreaterThanOrEqual(1);
      });

      it("should filter conversions by type", async () => {
        // Create a purchase conversion first
        await api.post(
          "/admin/ad-planning/conversions",
          {
            conversion_type: "purchase",
            website_id: websiteId,
            visitor_id: "filter_type_visitor",
            conversion_value: 1000,
          },
          headers
        );

        const response = await api.get(
          "/admin/ad-planning/conversions?conversion_type=purchase",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.conversions.every(
            (c: any) => c.conversion_type === "purchase"
          )
        ).toBe(true);
      });

      it("should filter conversions by website", async () => {
        // Create a conversion for this website
        await api.post(
          "/admin/ad-planning/conversions",
          {
            conversion_type: "page_engagement",
            website_id: websiteId,
            visitor_id: "filter_website_visitor",
          },
          headers
        );

        const response = await api.get(
          `/admin/ad-planning/conversions?website_id=${websiteId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.conversions.every(
            (c: any) => c.website_id === websiteId
          )
        ).toBe(true);
      });

      it("should support pagination", async () => {
        const response = await api.get(
          "/admin/ad-planning/conversions?limit=2&offset=0",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.conversions.length).toBeLessThanOrEqual(2);
        expect(response.data.limit).toBe(2);
        expect(response.data.offset).toBe(0);
      });
    });

    describe("GET /admin/ad-planning/conversions/:id", () => {
      it("should get a specific conversion", async () => {
        // Create a conversion first
        const createResponse = await api.post(
          "/admin/ad-planning/conversions",
          {
            conversion_type: "custom",
            website_id: websiteId,
            visitor_id: "get_specific_visitor",
          },
          headers
        );
        const testConversionId = createResponse.data.conversion.id;

        const response = await api.get(
          `/admin/ad-planning/conversions/${testConversionId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.conversion).toBeDefined();
        expect(response.data.conversion.id).toBe(testConversionId);
      });
    });

    describe("GET /admin/ad-planning/conversions/stats", () => {
      it("should get conversion statistics", async () => {
        const response = await api.get(
          "/admin/ad-planning/conversions/stats",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.totals.total_conversions).toBeDefined();
        expect(response.data.totals.total_value).toBeDefined();
        expect(response.data.totals.by_type).toBeDefined();
      });

      it("should get stats filtered by website", async () => {
        // Create a conversion first
        await api.post(
          "/admin/ad-planning/conversions",
          {
            conversion_type: "page_engagement",
            website_id: websiteId,
            visitor_id: "stats_test_visitor",
          },
          headers
        );

        const response = await api.get(
          `/admin/ad-planning/conversions/stats?website_id=${websiteId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.totals.total_conversions).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("Public Conversion Tracking", () => {
    describe("POST /web/ad-planning/track-conversion", () => {
      it("should track a conversion from client-side", async () => {
        const trackingData = {
          conversion_type: "page_engagement",
          website_id: websiteId,
          visitor_id: "client_visitor_001",
          session_id: "client_session_001",
          pathname: "/blog/article-1",
          metadata: {
            scroll_depth: 75,
            time_on_page: 120,
          },
        };

        // Note: This endpoint should be public (no auth required)
        const response = await api.post(
          "/web/ad-planning/track-conversion",
          trackingData
        );

        // The endpoint returns 200 for security (doesn't expose creation status)
        expect(response.status).toBe(200);
        expect(response.data.success).toBe(true);
        expect(response.data.conversion_id).toBeDefined();
      });
    });
  });

  describe("DELETE /admin/ad-planning/goals/:id", () => {
    it("should delete a conversion goal", async () => {
      // Create a goal to delete
      const createResponse = await api.post(
        "/admin/ad-planning/goals",
        {
          name: "Goal to Delete",
          goal_type: "custom_event",
          conditions: {
            event_name: "delete_test",
          },
        },
        headers
      );

      const goalToDelete = createResponse.data.goal.id;

      const response = await api.delete(
        `/admin/ad-planning/goals/${goalToDelete}`,
        headers
      );

      expect(response.status).toBe(200);
      expect(response.data.deleted).toBe(true);

      // Verify deletion
      const verifyResponse = await api
        .get(`/admin/ad-planning/goals/${goalToDelete}`, headers)
        .catch((e) => e.response);

      expect(verifyResponse.status).toBe(404);
    });
  });
});
