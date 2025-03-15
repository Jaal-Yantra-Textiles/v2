import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(30000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let inventoryId;
    let rawMaterialId;
    let categoryId;

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
      
      // Create a material category for testing updates
      const categoryData = {
        name: "Test Fabric Category",
        description: "Test category for updating materials",
        category: "Fabric"
      };
      
      const categoryResponse = await api.post("/admin/categories/rawmaterials", categoryData, headers);
      expect(categoryResponse.status).toBe(200);
      categoryId = categoryResponse.data.id;
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
            // Use a string for material_type for new categories
            material_type: "Cotton"
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
        // Material type might be created automatically with a default value in some implementations
        // So we'll just check that the response has the correct structure
        if (response.data.raw_materials.material_type) {
          expect(response.data.raw_materials.material_type).toMatchObject({
            id: expect.any(String)
          });
        }
      });

      it("should return 404 for non-existent inventory", async () => {
        const rawMaterialData = {
          rawMaterialData: {
            name: "Test Material",
            description: "Test Description",
            composition: "100% Test Material",
            status: "Active",
            material_type: "Test Material"
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
            material_type: "Test Material"
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

    describe("PUT /admin/inventory-items/:id/rawmaterials/:rawMaterialId", () => {
      beforeEach(async () => {
        // Create a raw material to update in these tests
        const rawMaterialData = {
          rawMaterialData: {
            name: "Initial Material",
            description: "Material for update tests",
            composition: "100% Test Material",
            unit_of_measure: "Meter",
            status: "Active",
            // For a new material type, just pass the name as a string
            material_type: "Initial Type"
          }
        };

        const response = await api.post(
          `/admin/inventory-items/${inventoryId}/rawmaterials`,
          rawMaterialData,
          headers
        );

        expect(response.status).toBe(201);
        rawMaterialId = response.data.raw_materials.id;
      });

      it("should update basic properties of a raw material", async () => {
        const updateData = {
          rawMaterialData: {
            name: "Updated Material Name",
            description: "Updated description",
            composition: "Updated composition 80/20",
            status: "Under_Review"
          }
        };

        const response = await api.put(
          `/admin/inventory-items/${inventoryId}/rawmaterials/${rawMaterialId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.raw_material).toMatchObject({
          id: rawMaterialId,
          name: updateData.rawMaterialData.name,
          description: updateData.rawMaterialData.description,
          composition: updateData.rawMaterialData.composition,
          status: updateData.rawMaterialData.status,
        });
      });

      it("should update raw material with a new material type (string)", async () => {
        const updateData = {
          rawMaterialData: {
            name: "Updated With New Type",
            description: "Updated description",
            composition: "100% Cotton",
            material_type: "New Material Type"
          }
        };

        const response = await api.put(
          `/admin/inventory-items/${inventoryId}/rawmaterials/${rawMaterialId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.raw_material).toMatchObject({
          id: rawMaterialId,
          name: updateData.rawMaterialData.name,
        });
        
        // Check that material_type has been updated
        expect(response.data.raw_material.material_type).toBeTruthy();
        expect(response.data.raw_material.material_type.name).toBe("New Material Type");
      });

      it("should update raw material with an existing material type (by ID)", async () => {
        // For existing categories, we need to use material_type_id
        const updateData = {
          rawMaterialData: {
            name: "Updated With Existing Category",
            composition: "Updated composition",
            decription: "Updated description",
            // Use the ID of our pre-created category
            material_type_id: categoryId
          }
        };

        const response = await api.put(
          `/admin/inventory-items/${inventoryId}/rawmaterials/${rawMaterialId}`,
          updateData,
          headers
        );

        expect(response.status).toBe(200);
        expect(response.data.raw_material).toMatchObject({
          id: rawMaterialId,
          name: updateData.rawMaterialData.name,
        });
        
        // Verify that material_type now points to our test category
        expect(response.data.raw_material.material_type.id).toBe(categoryId);
      });

      it("should return 404 for non-existent raw material", async () => {
        const updateData = {
          rawMaterialData: {
            name: "Updated Name",
            composition: "Updated composition",
           
          }
        };

        const response = await api.put(
          `/admin/inventory-items/${inventoryId}/rawmaterials/non-existent-id`,
          updateData,
          headers
        ).catch(error => error.response);

        expect(response.status).toBe(404);
      });
    });
  }
});
