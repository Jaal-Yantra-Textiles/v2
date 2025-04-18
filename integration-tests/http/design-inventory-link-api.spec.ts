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
      //await createAdminUser(container);
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
        
        expect(response.data).toEqual({
          message: "InventoryItem with id: non-existent-id was not found"
        });
      });

      it("should fail when linking to non-existent design", async () => {
        const linkData = {
          inventoryIds: [cottonFabricId]
        };

        const response = await api
          .post(`/admin/designs/non-existent-id/inventory`, linkData, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(404);
        console.log(response.data);
        expect(response.data).toEqual({
          
          message: 'Design with id "non-existent-id" not found'
        });
      });
    });

    describe("GET /admin/designs/:id/inventory", () => {
      it("should return linked inventory items", async () => {
        // First link some inventory items
        await api.post(
          `/admin/designs/${designId}/inventory`,
          { inventoryIds: [cottonFabricId, buttonsId] },
          headers
        );

        const response = await api.get(
          `/admin/designs/${designId}/inventory`,
          headers
        );
        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
        expect(Array.isArray(response.data.inventory_items)).toBe(true);
        expect(response.data.inventory_items.length).toBe(2);

        // Check if both inventory items are present
        const inventoryIds = response.data.inventory_items.map(item => item.id);
        expect(inventoryIds).toContain(cottonFabricId);
        expect(inventoryIds).toContain(buttonsId);
      });

      it("should return empty array for design with no inventory", async () => {
        // Create a new design without linking any inventory
        const newDesignResponse = await api.post("/admin/designs", testDesign, headers);
        const newDesignId = newDesignResponse.data.design.id;

        const response = await api.get(
          `/admin/designs/${newDesignId}/inventory`,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data).toBeDefined();
        expect(Array.isArray(response.data.inventory_items)).toBe(true);
        expect(response.data.inventory_items).toHaveLength(0);
      });

      it("should fail for non-existent design", async () => {
        const response = await api
          .get(`/admin/designs/non-existent-id/inventory`, headers)
          .catch((err) => err.response);
        
        expect(response.status).toBe(404);
        expect(response.data).toEqual({
          message: 'Design with id: non-existent-id was not found'
        });
      });
    });
  }
});
