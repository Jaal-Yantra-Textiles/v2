/**
 * Ad Planning - Customer Segments API Integration Tests
 *
 * Tests customer segmentation, criteria evaluation, and member management.
 */

import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(60 * 1000);

setupSharedTestSuite(() => {
  let headers: any;
  let segmentId: string;

  const { api, getContainer } = getSharedTestEnv();

  beforeAll(async () => {
    const container = getContainer();
    await createAdminUser(container);
    headers = await getAuthHeaders(api);
  });

  describe("Customer Segments CRUD", () => {
    describe("POST /admin/ad-planning/segments", () => {
      it("should create a behavioral segment", async () => {
        const segmentData = {
          name: "High Value Customers",
          description: "Customers with CLV > 10000",
          segment_type: "behavioral",
          criteria: {
            rules: [
              {
                field: "clv_score",
                operator: ">=",
                value: 10000,
              },
            ],
            logic: "AND",
          },
          is_active: true,
          auto_update: true,
          color: "#4CAF50",
        };

        const response = await api.post(
          "/admin/ad-planning/segments",
          segmentData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.segment).toBeDefined();
        expect(response.data.segment.name).toBe(segmentData.name);
        expect(response.data.segment.segment_type).toBe("behavioral");
        expect(response.data.segment.is_active).toBe(true);

        segmentId = response.data.segment.id;
      });

      it("should create an RFM segment", async () => {
        const segmentData = {
          name: "Champions",
          description: "Best customers - high recency, frequency, monetary",
          segment_type: "rfm",
          criteria: {
            rules: [
              { field: "total_purchases", operator: ">=", value: 5 },
              { field: "total_revenue", operator: ">=", value: 5000 },
              { field: "days_since_last_purchase", operator: "<=", value: 30 },
            ],
            logic: "AND",
          },
        };

        const response = await api.post(
          "/admin/ad-planning/segments",
          segmentData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.segment.segment_type).toBe("rfm");
      });

      it("should create a demographic segment", async () => {
        const segmentData = {
          name: "Promoters",
          description: "NPS promoters (score >= 9)",
          segment_type: "demographic",
          criteria: {
            rules: [{ field: "nps_score", operator: ">=", value: 9 }],
            logic: "AND",
          },
        };

        const response = await api.post(
          "/admin/ad-planning/segments",
          segmentData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.segment.segment_type).toBe("demographic");
      });

      it("should create a segment with OR logic", async () => {
        const segmentData = {
          name: "At Risk or Inactive",
          description: "Customers at risk of churning or already inactive",
          segment_type: "custom",
          criteria: {
            rules: [
              { field: "churn_risk", operator: ">=", value: 70 },
              { field: "engagement_score", operator: "<=", value: 10 },
            ],
            logic: "OR",
          },
        };

        const response = await api.post(
          "/admin/ad-planning/segments",
          segmentData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.segment.criteria.logic).toBe("OR");
      });
    });

    describe("GET /admin/ad-planning/segments", () => {
      it("should list all segments", async () => {
        // Create a segment first
        await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Test Segment for List",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );

        const response = await api.get(
          "/admin/ad-planning/segments",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segments).toBeDefined();
        expect(response.data.segments.length).toBeGreaterThanOrEqual(1);
      });

      it("should filter segments by type", async () => {
        const response = await api.get(
          "/admin/ad-planning/segments?segment_type=behavioral",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.segments.every(
            (s: any) => s.segment_type === "behavioral"
          )
        ).toBe(true);
      });

      it("should filter active segments", async () => {
        const response = await api.get(
          "/admin/ad-planning/segments?is_active=true",
          headers
        );

        expect(response.status).toBe(200);
        expect(
          response.data.segments.every((s: any) => s.is_active === true)
        ).toBe(true);
      });

      it("should support pagination", async () => {
        const response = await api.get(
          "/admin/ad-planning/segments?limit=2&offset=0",
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segments.length).toBeLessThanOrEqual(2);
      });
    });

    describe("GET /admin/ad-planning/segments/:id", () => {
      it("should get a specific segment", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Test Segment for Get",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const response = await api.get(
          `/admin/ad-planning/segments/${testSegmentId}`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segment).toBeDefined();
        expect(response.data.segment.id).toBe(testSegmentId);
        expect(response.data.segment.criteria).toBeDefined();
      });

      it("should return 404 for non-existent segment", async () => {
        const response = await api
          .get("/admin/ad-planning/segments/non-existent-id", headers)
          .catch((e) => e.response);

        expect(response.status).toBe(404);
      });
    });

    describe("PUT /admin/ad-planning/segments/:id", () => {
      it("should update a segment", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment to Update",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const updateData = {
          name: "Updated High Value Customers",
          description: "Updated description",
        };

        const response = await api.put(
          `/admin/ad-planning/segments/${testSegmentId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segment.name).toBe(updateData.name);
      });

      it("should update segment criteria", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment for Criteria Update",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const updateData = {
          criteria: {
            rules: [
              { field: "clv_score", operator: ">=", value: 15000 },
              { field: "engagement_score", operator: ">=", value: 50 },
            ],
            logic: "AND",
          },
        };

        const response = await api.put(
          `/admin/ad-planning/segments/${testSegmentId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segment.criteria.rules.length).toBe(2);
      });

      it("should deactivate a segment", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment to Deactivate",
            segment_type: "custom",
            is_active: true,
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const response = await api.put(
          `/admin/ad-planning/segments/${testSegmentId}`,
          { is_active: false },
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segment.is_active).toBe(false);
      });
    });
  });

  describe("Segment Building", () => {
    describe("POST /admin/ad-planning/segments/:id/build", () => {
      it("should rebuild a segment", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment to Build",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const response = await api.post(
          `/admin/ad-planning/segments/${testSegmentId}/build`,
          {},
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segment).toBeDefined();
        expect(response.data.build_result).toBeDefined();
        expect(response.data.build_result.total_evaluated).toBeDefined();
        expect(response.data.build_result.matching_count).toBeDefined();
        expect(response.data.message).toContain("rebuilt");
      });

      it("should return updated customer count after build", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment for Count Test",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const response = await api.post(
          `/admin/ad-planning/segments/${testSegmentId}/build`,
          {},
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segment.customer_count).toBeDefined();
        expect(response.data.segment.last_calculated_at).toBeDefined();
      });
    });

    describe("GET /admin/ad-planning/segments/:id/members", () => {
      it("should list segment members", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment for Members List",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const response = await api.get(
          `/admin/ad-planning/segments/${testSegmentId}/members`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.segment).toBeDefined();
        expect(response.data.members).toBeDefined();
        expect(Array.isArray(response.data.members)).toBe(true);
      });

      it("should include person details in members", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment for Members Details",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const response = await api.get(
          `/admin/ad-planning/segments/${testSegmentId}/members`,
          headers
        );

        expect(response.status).toBe(200);
        if (response.data.members.length > 0) {
          expect(response.data.members[0].person_id).toBeDefined();
          expect(response.data.members[0].added_at).toBeDefined();
        }
      });

      it("should support pagination for members", async () => {
        // Create a segment first
        const createResponse = await api.post(
          "/admin/ad-planning/segments",
          {
            name: "Segment for Members Pagination",
            segment_type: "custom",
            criteria: { rules: [{ field: "test", operator: ">=", value: 1 }], logic: "AND" },
          },
          headers
        );
        const testSegmentId = createResponse.data.segment.id;

        const response = await api.get(
          `/admin/ad-planning/segments/${testSegmentId}/members?limit=10&offset=0`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.members.length).toBeLessThanOrEqual(10);
        expect(response.data.limit).toBe(10);
        expect(response.data.offset).toBe(0);
      });
    });
  });

  describe("DELETE /admin/ad-planning/segments/:id", () => {
    it("should delete a segment", async () => {
      // Create a segment to delete
      const createResponse = await api.post(
        "/admin/ad-planning/segments",
        {
          name: "Segment to Delete",
          segment_type: "custom",
          criteria: {
            rules: [{ field: "total_purchases", operator: ">=", value: 1 }],
            logic: "AND",
          },
        },
        headers
      );
      const segmentToDelete = createResponse.data.segment.id;

      const response = await api.delete(
        `/admin/ad-planning/segments/${segmentToDelete}`,
        headers
      );

      expect(response.status).toBe(200);
      expect(response.data.deleted).toBe(true);

      // Verify deletion
      const verifyResponse = await api
        .get(`/admin/ad-planning/segments/${segmentToDelete}`, headers)
        .catch((e) => e.response);

      expect(verifyResponse.status).toBe(404);
    });
  });
});
