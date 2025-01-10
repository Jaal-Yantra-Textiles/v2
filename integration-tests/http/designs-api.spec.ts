import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(30000);

const summerDesign = {
  name: "Summer Collection 2025",
  description: "Lightweight summer wear collection",
  design_type: "Original",
  status: "Conceptual",
  priority: "High",
  target_completion_date: new Date("2025-06-30"),
  tags: ["summer", "casual", "lightweight"],
  color_palette: [
    { name: "Ocean Blue", code: "#0077be" },
    { name: "Sandy Beige", code: "#f5deb3" }
  ],
  estimated_cost: 5000,
  designer_notes: "Focus on breathable fabrics",
  inspiration_sources: ["nature", "ocean"],
  design_files: ["file1.svg", "file2.svg"],
  thumbnail_url: "https://example.com/thumbnail.jpg",
  custom_sizes: { 
    S: { chest: 36, length: 28 },
    M: { chest: 38, length: 29 }
  },
  metadata: {
    season: "Summer 2025",
    collection: "Coastal Breeze"
  }
};

const winterDesign = {
  name: "Winter Collection 2025",
  description: "Warm winter wear collection",
  design_type: "Original",
  status: "In_Development",
  priority: "Medium",
  target_completion_date: new Date("2025-11-30"),
  tags: ["winter", "warm", "cozy"],
  color_palette: [
    { name: "Forest Green", code: "#228B22" },
    { name: "Burgundy", code: "#800020" }
  ],
  estimated_cost: 7500,
  designer_notes: "Focus on insulation and layering",
  inspiration_sources: ["nordic", "alpine"],
  design_files: ["winter1.svg", "winter2.svg"],
  thumbnail_url: "https://example.com/winter-thumbnail.jpg",
  custom_sizes: { 
    S: { chest: 38, length: 30 },
    M: { chest: 40, length: 31 }
  },
  metadata: {
    season: "Winter 2025",
    collection: "Arctic Frost"
  }
};

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let summerDesignId;
    let winterDesignId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

      // Create summer design
      const summerResponse = await api.post("/admin/designs", summerDesign, headers);
      
      summerDesignId = summerResponse.data.design.id;

      // Create winter design
      const winterResponse = await api.post("/admin/designs", winterDesign, headers);
    
      winterDesignId = winterResponse.data.design.id;
    });

    describe("POST /admin/designs", () => {
      it("should fail to create a design without required fields", async () => {
        const invalidDesign = {
          description: "Missing required name field"
        };

        const response = await api
          .post("/admin/designs", invalidDesign, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(400);
      });

      describe("GET /admin/designs", () => {
        it("should list all designs with pagination", async () => {
          const response = await api.get("/admin/designs", {
            headers: headers.headers,
          });
        
          expect(response.status).toBe(200);
          expect(response.data.designs).toBeInstanceOf(Array);
          expect(response.data.designs.length).toBeGreaterThanOrEqual(2);
          expect(response.data).toHaveProperty("count");
          expect(response.data).toHaveProperty("offset");
          expect(response.data).toHaveProperty("limit");
        });

        it("should filter designs by status", async () => {
          const response = await api.get("/admin/designs?status=Conceptual", {
            headers: headers.headers,
          });

          expect(response.status).toBe(200);
          expect(response.data.designs).toBeInstanceOf(Array);
          expect(response.data.designs.length).toBeGreaterThanOrEqual(1);
          expect(response.data.designs).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: summerDesignId,
                status: "Conceptual"
              })
            ])
          );
        });

        it("should filter designs by multiple criteria", async () => {
          const response = await api.get(
            "/admin/designs?status=In_Development&priority=Medium", 
            {
              headers: headers.headers,
            }
          );

          expect(response.status).toBe(200);
          expect(response.data.designs).toBeInstanceOf(Array);
          expect(response.data.designs).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                id: winterDesignId,
                status: "In_Development",
                priority: "Medium"
              })
            ])
          );
        });
      });

      describe("GET /admin/designs/:id", () => {
        it("should retrieve summer design", async () => {
          const response = await api.get(`/admin/designs/${summerDesignId}`, {
            headers: headers.headers,
          });

          expect(response.status).toBe(200);
          expect(response.data.design.id).toBe(summerDesignId);
          expect(response.data.design).toMatchObject({
            ...summerDesign,
            target_completion_date: summerDesign.target_completion_date.toISOString(),
            id: summerDesignId,
          });
        });
        

        it("should retrieve winter design", async () => {
          const response = await api.get(`/admin/designs/${winterDesignId}`, {
            headers: headers.headers,
          });
          
        
          expect(response.status).toBe(200);
          expect(response.data.design.id).toBe(winterDesignId);
          expect(response.data.design).toMatchObject({
            ...winterDesign,
            target_completion_date: winterDesign.target_completion_date.toISOString(),
            id: winterDesignId,
          });
        });

        it("should return 404 for non-existent design", async () => {
          const response = await api
            .get("/admin/designs/non-existent-id", {
              headers: headers.headers,
            })
            .catch((err) => err.response);
          expect(response.status).toBe(404);
        });
      });

      describe("PUT /admin/designs/:id", () => {
        it("should update summer design", async () => {
          const updateData = {
            name: "Updated Summer Collection",
            status: "In_Development",
            priority: "Medium",
            color_palette: [
              { name: "Sunset Orange", code: "#FD5E53" }
            ],
            tags: ["updated", "summer", "trendy"],
            metadata: {
              version: "2.0"
            }
          };

          const response = await api.put(
            `/admin/designs/${summerDesignId}`,
            updateData,
            headers
          );
          

          expect(response.status).toBe(200);
          expect(response.data.design).toMatchObject({
            ...updateData,
            id: summerDesignId,
          });
        });

        it("should fail to update non-existent design", async () => {
          const response = await api
            .put(
              "/admin/designs/non-existent-id",
              { name: "Test Update" },
              headers
            )
            .catch((err) => err.response);

          expect(response.status).toBe(404);
        });
      });

      describe("DELETE /admin/designs/:id", () => {
        it("should delete winter design", async () => {
          const response = await api.delete(
            `/admin/designs/${winterDesignId}`,
            headers
          );

          expect(response.status).toBe(204);

          // Verify deletion
          const getResponse = await api
            .get(`/admin/designs/${winterDesignId}`, {
              headers: headers.headers,
            })
            .catch((err) => err.response);

          expect(getResponse.status).toBe(404);
        });

        it("should fail to delete non-existent design", async () => {
          const response = await api
            .delete("/admin/designs/non-existent-id", headers)
            .catch((err) => err.response);

          expect(response.status).toBe(404);
        });
      });
    });
  },
});