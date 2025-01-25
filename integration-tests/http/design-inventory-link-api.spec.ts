import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

/**
 * This is a simple case where we assume that Raw_maeterials are attached already 
 */

jest.setTimeout(30000);

const testDesign = {
  name: "Summer T-Shirt Design",
  description: "Basic cotton t-shirt design",
  design_type: "Original",
  status: "In_Development",
  priority: "Medium",
  target_completion_date: new Date("2025-06-30"),
  tags: ["summer", "basic", "cotton"],
  metadata: {
    season: "Summer 2025",
    collection: "Basics"
  }
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let designId;
    let cottonFabricId;
    let buttonsId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

      // Create the design first
      const designResponse = await api.post("/admin/designs", testDesign, headers);
      expect(designResponse.status).toBe(201);
      designId = designResponse.data.design.id;

      // Create Cotton Fabric inventory
      const cottonFabric = {
        title: "Cotton Fabric",
        description: "High quality cotton fabric for t-shirts",
      };
      const cottonResponse = await api.post("/admin/inventory-items", cottonFabric, headers);
      expect(cottonResponse.status).toBe(200);
      cottonFabricId = cottonResponse.data.inventory_item.id;

      // Create Buttons inventory
      const buttons = {
        title: "Buttons",
        description: "Plastic buttons for t-shirts",
      };
      const buttonsResponse = await api.post("/admin/inventory-items", buttons, headers);
      expect(buttonsResponse.status).toBe(200);
      buttonsId = buttonsResponse.data.inventory_item.id;
    });

    describe("POST /admin/designs/:id/inventory", () => {
      it("should link inventory items to design", async () => {
        const linkData = {
          inventoryIds: [cottonFabricId, buttonsId]
        };

        const response = await api.post(
          `/admin/designs/${designId}/inventory`,
          linkData,
          headers
        );

        expect(response.status).toBe(201);
        expect(response.data.inventory_items).toBeDefined();
        expect(response.data.inventory_items.map(item => ({
          design_id: designId,
          inventory_id: item.id
        }))).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              design_id: designId,
              inventory_id: cottonFabricId
            }),
            expect.objectContaining({
              design_id: designId,
              inventory_id: buttonsId
            })
          ])
        );
      });

      it("should fail when linking non-existent inventory items", async () => {
        const linkData = {
          inventoryIds: ["non-existent-id"]
        };

        const response = await api
          .post(`/admin/designs/${designId}/inventory`, linkData, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
        expect(response.data.message).toContain("not found");
      });

      it("should fail when linking to non-existent design", async () => {
        const linkData = {
          inventoryIds: [cottonFabricId]
        };

        const response = await api
          .post(`/admin/designs/non-existent-id/inventory`, linkData, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
        expect(response.data.message).toContain("not found");
      });
    });
  }
});
