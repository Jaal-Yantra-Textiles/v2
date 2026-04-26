import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(30000);

const testDesign = {
  name: "Test Design for Product Linking",
  description: "A test design for product linking integration tests",
  design_type: "Original",
  status: "Commerce_Ready",
  priority: "High",
  target_completion_date: new Date("2025-12-31"),
  tags: ["test", "integration"],
  color_palette: [
    { name: "Test Blue", code: "#0077be" },
    { name: "Test Red", code: "#ff0000" }
  ],
  estimated_cost: 1000,
  designer_notes: "Test design for integration testing",
  inspiration_sources: ["testing"],
  design_files: ["test.svg"],
  thumbnail_url: "https://example.com/test-thumbnail.jpg",
  custom_sizes: { 
    M: { chest: 38, length: 29 }
  },
  metadata: {
    purpose: "integration-testing"
  }
};

const testProduct = {
  title: "Test Product for Design Linking",
  description: "A test product for design linking integration tests",
  status: "published",
  handle: "test-product-design-linking",
  options: [{ title: "Default", values: ["Default Option"] }]
};

setupSharedTestSuite(() => {
    let headers;
    let testDesignId;
    let testProductId;
    const { api , getContainer } = getSharedTestEnv();
    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

      // Create test design
      const designResponse = await api.post("/admin/designs", testDesign, headers);
      testDesignId = designResponse.data.design.id;

      // Create test product
      const productResponse = await api.post("/admin/products", testProduct, headers);
      testProductId = productResponse.data.product.id;
    });

    describe("POST /admin/products/:id/linkDesign", () => {
      it("should successfully link a design to a product", async () => {
        const linkPayload = {
          designId: testDesignId
        };

        const response = await api.post(
          `/admin/products/${testProductId}/linkDesign`,
          linkPayload,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("product");
        expect(response.data.product).toHaveProperty("id", testProductId);
        expect(response.data.product).toHaveProperty("designs");
        expect(response.data.product.designs).toBeInstanceOf(Array);
        expect(response.data.product.designs.length).toBeGreaterThan(0);
        expect(response.data.product.designs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: testDesignId
            })
          ])
        );
      });

      it("should fail to link design to non-existent product", async () => {
        const nonExistentProductId = "prod_nonexistent123";
        const linkPayload = {
          designId: testDesignId
        };

        const response = await api
          .post(`/admin/products/${nonExistentProductId}/linkDesign`, linkPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
        expect(response.data).toHaveProperty("message");
        expect(response.data.message).toContain("Product with id");
        expect(response.data.message).toContain("was not found");
      });

      it("should fail to link non-existent design to product", async () => {
        const nonExistentDesignId = "design_nonexistent123";
        const linkPayload = {
          designId: nonExistentDesignId
        };

        const response = await api
          .post(`/admin/products/${testProductId}/linkDesign`, linkPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
        expect(response.data).toHaveProperty("message");
        expect(response.data.message).toContain("Design with id");
        expect(response.data.message).toContain("was not found");
      });

      it("should fail to link design without designId in payload", async () => {
        const invalidPayload = {};

        const response = await api
          .post(`/admin/products/${testProductId}/linkDesign`, invalidPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(400);
      });

      it("should fail to link design with invalid designId format", async () => {
        const invalidPayload = {
          designId: ""
        };

        const response = await api
          .post(`/admin/products/${testProductId}/linkDesign`, invalidPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
      });
    });

    describe("POST /admin/products/:id/unlinkDesign", () => {
      beforeEach(async () => {
        // Link design to product before each unlink test
        const linkPayload = {
          designId: testDesignId
        };
        await api.post(
          `/admin/products/${testProductId}/linkDesign`,
          linkPayload,
          headers
        );
      });

      it("should successfully unlink a design from a product", async () => {
        const unlinkPayload = {
          designId: testDesignId
        };

        const response = await api.post(
          `/admin/products/${testProductId}/unlinkDesign`,
          unlinkPayload,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty("success", true);
      });

      it("should fail to unlink design from non-existent product", async () => {
        const nonExistentProductId = "prod_nonexistent123";
        const unlinkPayload = {
          designId: testDesignId
        };

        const response = await api
          .post(`/admin/products/${nonExistentProductId}/unlinkDesign`, unlinkPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
        expect(response.data).toHaveProperty("message");
        expect(response.data.message).toContain("Product with id");
        expect(response.data.message).toContain("was not found");
      });

      it("should fail to unlink non-existent design from product", async () => {
        const nonExistentDesignId = "design_nonexistent123";
        const unlinkPayload = {
          designId: nonExistentDesignId
        };

        const response = await api
          .post(`/admin/products/${testProductId}/unlinkDesign`, unlinkPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
        expect(response.data).toHaveProperty("message");
        expect(response.data.message).toContain("Design with id");
        expect(response.data.message).toContain("was not found");
      });

      it("should fail to unlink design without designId in payload", async () => {
        const invalidPayload = {};

        const response = await api
          .post(`/admin/products/${testProductId}/unlinkDesign`, invalidPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(400);
      });

      it("should fail to unlink design with invalid designId format", async () => {
        const invalidPayload = {
          designId: ""
        };

        const response = await api
          .post(`/admin/products/${testProductId}/unlinkDesign`, invalidPayload, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
      });
    });

    describe("Product-Design Link Integration Flow", () => {
      it("should complete full link-unlink cycle successfully", async () => {
        // Step 1: Link design to product
        const linkPayload = {
          designId: testDesignId
        };

        const linkResponse = await api.post(
          `/admin/products/${testProductId}/linkDesign`,
          linkPayload,
          headers
        );

        expect(linkResponse.status).toBe(200);
        expect(linkResponse.data.product.designs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: testDesignId
            })
          ])
        );

        // Step 2: Verify product has the design linked
        const productResponse = await api.get(
          `/admin/products/${testProductId}?fields=designs.*`,
          { headers: headers.headers }
        );

        expect(productResponse.status).toBe(200);
       
        expect(productResponse.data.product).toHaveProperty("designs");
        expect(productResponse.data.product.designs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: testDesignId
            })
          ])
        );

        // Step 3: Unlink design from product
        const unlinkPayload = {
          designId: testDesignId
        };

        const unlinkResponse = await api.post(
          `/admin/products/${testProductId}/unlinkDesign`,
          unlinkPayload,
          headers
        );

        expect(unlinkResponse.status).toBe(200);
        expect(unlinkResponse.data).toHaveProperty("success", true);

        // Step 4: Verify design is no longer linked to product
        const finalProductResponse = await api.get(
          `/admin/products/${testProductId}`,
          { headers: headers.headers }
        );

        expect(finalProductResponse.status).toBe(200);
        // The product should either have no designs property or an empty designs array
        if (finalProductResponse.data.product.designs) {
          expect(finalProductResponse.data.product.designs).not.toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: testDesignId
              })
            ])
          );
        }
      });

      it("should handle multiple designs linked to same product", async () => {
        // Create a second design
        const secondDesign = {
          ...testDesign,
          name: "Second Test Design for Product Linking",
          description: "A second test design for product linking"
        };

        const secondDesignResponse = await api.post("/admin/designs", secondDesign, headers);
        const secondDesignId = secondDesignResponse.data.design.id;

        // Link first design
        await api.post(
          `/admin/products/${testProductId}/linkDesign`,
          { designId: testDesignId },
          headers
        );

        // Link second design
        const secondLinkResponse = await api.post(
          `/admin/products/${testProductId}/linkDesign`,
          { designId: secondDesignId },
          headers
        );

        expect(secondLinkResponse.status).toBe(200);
        expect(secondLinkResponse.data.product.designs).toHaveLength(2);
        expect(secondLinkResponse.data.product.designs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: testDesignId }),
            expect.objectContaining({ id: secondDesignId })
          ])
        );

        // Unlink first design only
        const unlinkResponse = await api.post(
          `/admin/products/${testProductId}/unlinkDesign`,
          { designId: testDesignId },
          headers
        );

        expect(unlinkResponse.status).toBe(200);

        // Verify only second design remains linked
        const finalProductResponse = await api.get(
          `/admin/products/${testProductId}?fields=designs.*`,
          { headers: headers.headers }
        );

        expect(finalProductResponse.data.product.designs).toHaveLength(1);
        expect(finalProductResponse.data.product.designs).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: secondDesignId })
          ])
        );
      });
    });
});
