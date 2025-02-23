import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(30000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let inventoryId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

      // Create an inventory item first
      const newInventory = {
        title: "Test Inventory",
        description: "Test Description",
      };

      const response = await api.post("/admin/inventory-items", newInventory, headers);
      expect(response.status).toBe(200);
      inventoryId = response.data.inventory_item.id;
    });

    describe("POST /admin/inventory-items/:id/rawmaterials", () => {
      it("should create raw material with material type", async () => {
        const rawMaterialData = {
          rawMaterialData: {
            name: "Cotton Fabric",
            description: "High quality cotton fabric",
            composition: "100% Cotton",
            unit_of_measure: "Meter",
            minimum_order_quantity: 100,
            lead_time_days: 7,
            color: "White",
            width: "60 inches",
            weight: "150 gsm",
            grade: "Premium",
            certification: {
              gots: true,
              organic: true
            },
            usage_guidelines: "Machine wash cold",
            storage_requirements: "Store in cool, dry place",
            status: "Active",
            material_type: {
              name: "Cotton",
              description: "Natural fiber material",
              category: "Fiber",
              properties: {
                origin: "India",
                grade: "Premium"
              }
            }
          }
        };

        const response = await api.post(
          `/admin/inventory-items/${inventoryId}/rawmaterials`,
          rawMaterialData,
          headers
        );

        expect(response.status).toBe(201);
      
        expect(response.data.raw_materials).toMatchObject({
          id: expect.any(String),
          name: rawMaterialData.rawMaterialData.name,
          composition: rawMaterialData.rawMaterialData.composition,
          material_type: expect.objectContaining({
            id: expect.any(String),
          })
        });
      });

      it("should create raw material without material type", async () => {
        const rawMaterialData = {
          rawMaterialData: {
            name: "Polyester Blend",
            description: "Blended polyester material",
            composition: "80% Polyester, 20% Cotton",
            unit_of_measure: "Meter",
            minimum_order_quantity: 50,
            lead_time_days: 5,
            color: "Black",
            width: "58 inches",
            weight: "120 gsm",
            grade: "Standard",
            status: "Active"
          }
        };

        const response = await api.post(
          `/admin/inventory-items/${inventoryId}/rawmaterials`,
          rawMaterialData,
          headers
        );
    
        expect(response.status).toBe(201);
        expect(response.data.raw_materials).toMatchObject({
          id: expect.any(String),
          name: rawMaterialData.rawMaterialData.name,
          composition: rawMaterialData.rawMaterialData.composition
        });
        expect(response.data.raw_materials.material_type).toBeNull();
      });

      it("should return 404 for non-existent inventory", async () => {
        const rawMaterialData = {
          rawMaterialData: {
            name: "Test Material",
            description: "Test Description",
            composition: "100% Test Material",
            status: "Active",
            material_type: {
              name: "Test Material",
              category: "Other"
            }
          }
        };

        const response = await api.post(
          `/admin/inventory-items/non-existent-id/rawmaterials`,
          rawMaterialData,
          headers
        ).catch(error => error.response);

        expect(response.status).toBe(404);
      });

      it("should validate required composition field", async () => {
        const invalidData = {
          rawMaterialData: {
            name: "Test Material",
            description: "Test Description",
            // Missing composition field
            status: "Active",
            material_type: {
              name: "Test Material",
              category: "Other"
            }
          }
        };

        const response = await api.post(
          `/admin/inventory-items/${inventoryId}/rawmaterials`,
          invalidData,
          headers
        ).catch(error => error.response);
        expect(response.status).toBe(400);
        expect(response.data.message).toContain("Invalid request: Field 'rawMaterialData, composition' is required");
      });
    });
  }
});
