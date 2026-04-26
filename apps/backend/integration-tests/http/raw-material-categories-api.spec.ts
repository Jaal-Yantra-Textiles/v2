import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(30000);

// Sample categories for testing
const fiberCategory = {
  name: "Cotton Fiber",
  description: "Natural cotton fibers for textile production",
  category: "Fiber",
  properties: {
    origin: "Organic",
    quality: "Premium"
  },
  metadata: {
    sustainability: "High",
    certification: "GOTS"
  }
};

const fabricCategory = {
  name: "Denim Fabric",
  description: "Heavy-duty cotton twill fabric for jeans and jackets",
  category: "Fabric",
  properties: {
    weight: "12oz",
    weave: "Twill"
  },
  metadata: {
    uses: ["Jeans", "Jackets", "Workwear"]
  }
};

setupSharedTestSuite(() => {
    let headers;
    let fiberCategoryId;
    let fabricCategoryId;
    const { api , getContainer } = getSharedTestEnv();
    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
    });

    describe("POST /admin/categories/rawmaterials", () => {
      it("should create a new fiber category", async () => {
        const response = await api.post("/admin/categories/rawmaterials", fiberCategory, headers);
  
        expect(response.status).toBe(200);
        expect(response.data).toMatchObject({
          id: expect.any(String),
          name: fiberCategory.name,
          description: fiberCategory.description,
          category: fiberCategory.category,
          properties: fiberCategory.properties,
          metadata: fiberCategory.metadata
        });

        // Store ID for later tests
        fiberCategoryId = response.data.id;
      });

      it("should create a new fabric category", async () => {
        const response = await api.post("/admin/categories/rawmaterials", fabricCategory, headers);

        expect(response.status).toBe(200);
        expect(response.data).toMatchObject({
          id: expect.any(String),
          name: fabricCategory.name,
          description: fabricCategory.description,
          category: fabricCategory.category,
          properties: fabricCategory.properties,
          metadata: fabricCategory.metadata
        });

        // Store ID for later tests
        fabricCategoryId = response.data.id;
      });

      it("should fail to create a category without a name", async () => {
        const invalidCategory = {
          description: "Missing required name field",
          category: "Other"
        };

        const response = await api
          .post("/admin/categories/rawmaterials", invalidCategory, headers)
          .catch((err) => err.response);

        expect(response.status).toBe(400);
      });
    });

    describe("GET /admin/categories/rawmaterials", () => {
      // Create categories specifically for this test block to ensure independence
      beforeEach(async () => {
        // Create fresh categories for each test
        const fiberResponse = await api.post("/admin/categories/rawmaterials", fiberCategory, headers);
        fiberCategoryId = fiberResponse.data.id;
        
        const fabricResponse = await api.post("/admin/categories/rawmaterials", fabricCategory, headers);
        fabricCategoryId = fabricResponse.data.id;
      });

      it("should list all categories with pagination", async () => {
        const response = await api.get("/admin/categories/rawmaterials", {
          headers: headers.headers,
        });

        expect(response.status).toBe(200);
        expect(response.data.categories).toBeInstanceOf(Array);
        expect(response.data.categories.length).toBeGreaterThanOrEqual(2);
        expect(response.data).toHaveProperty("count");
        expect(response.data).toHaveProperty("offset");
        expect(response.data).toHaveProperty("limit");
      });

      it("should filter categories by name", async () => {
        const response = await api.get(`/admin/categories/rawmaterials?name=${fiberCategory.name}`, {
          headers: headers.headers,
        });

        expect(response.status).toBe(200);
        expect(response.data.categories).toBeInstanceOf(Array);
        expect(response.data.categories.some(cat => cat.name === fiberCategory.name)).toBe(true);
      });

      it("should filter categories by category type", async () => {
        const response = await api.get(`/admin/categories/rawmaterials?category=Fabric`, {
          headers: headers.headers,
        });

        expect(response.status).toBe(200);
        expect(response.data.categories).toBeInstanceOf(Array);
        expect(response.data.categories.some(cat => cat.category === "Fabric")).toBe(true);
      });
    });
});
