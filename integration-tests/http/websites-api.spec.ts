import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(60 * 1000);

medusaIntegrationTestRunner({
  testSuite: ({ api, getContainer }) => {
    let headers;
    let websiteId;
    let pageId;

    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);

      // Create a test website for all tests
      const newWebsite = {
        domain: "test.example.com",
        name: "Test Website",
        description: "A test website",
        status: "Development",
        primary_language: "en",
      };

      const response = await api.post("/admin/websites", newWebsite, headers);
      websiteId = response.data.website.id;
    });

    describe("Website CRUD Operations", () => {
      describe("POST /admin/websites", () => {
        it("should create a new website", async () => {
          const newWebsite = {
            domain: "another.example.com",
            name: "Another Website",
            description: "Another test website",
            status: "Development",
            primary_language: "en",
          };

          const response = await api.post("/admin/websites", newWebsite, headers);
          
          expect(response.status).toBe(201);
          expect(response.data.website).toMatchObject({
            ...newWebsite,
            id: expect.any(String),
            created_at: expect.any(String),
            updated_at: expect.any(String),
          });
        });

        it("should fail to create a website without required fields", async () => {
          const invalidWebsite = {
            description: "Missing required fields",
          };

          const response = await api.post("/admin/websites", invalidWebsite, headers).catch(e => e.response);
          expect(response.status).toBe(400);
          expect(response.data.issues).toBeDefined();
        });
      });

      describe("GET /admin/websites", () => {
        it("should list websites with pagination", async () => {
          // Create an additional website
          const additionalWebsite = {
            domain: "site2.example.com",
            name: "Site 2",
            status: "Development",
          };

          await api.post("/admin/websites", additionalWebsite, headers);

          const response = await api.get("/admin/websites?limit=10&offset=0", headers);
          expect(response.status).toBe(200);
          expect(response.data.websites.length).toBeGreaterThanOrEqual(2);
          expect(response.data.count).toBeGreaterThanOrEqual(2);
        });

        it("should filter websites by status", async () => {
          const response = await api.get("/admin/websites?status=Development", headers);
          expect(response.status).toBe(200);
          expect(response.data.websites.every(w => w.status === "Development")).toBe(true);
        });
      });

      describe("PUT /admin/websites/:id", () => {
        it("should update a website", async () => {
          const updateData = {
            name: "Updated Website Name",
            status: "Active",
          };
          const response = await api.put(`/admin/websites/${websiteId}`, updateData, headers);
          expect(response.status).toBe(200);
          expect(response.data.website.name).toBe(updateData.name);
          expect(response.data.website.status).toBe(updateData.status);
        });
      });
    });

    describe("Website Pages CRUD Operations", () => {
      describe("POST /admin/websites/:id/pages", () => {
        it("should create a single page", async () => {
          const newPage = {
            title: "Home Page",
            slug: "home",
            content: "Welcome to our website",
            page_type: "Home",
            status: "Draft",
          };

          const response = await api.post(
            `/admin/websites/${websiteId}/pages`,
            newPage,
            headers
          );
          
          expect(response.status).toBe(201);
          expect(response.data.page).toMatchObject({
            ...newPage,
            id: expect.any(String),
            website_id: websiteId,
          });

          pageId = response.data.page.id;
        });

        it("should create multiple pages in batch", async () => {
          const pages = [
            {
              title: "About Us",
              slug: "about",
              content: "About our company",
              page_type: "About",
            },
            {
              title: "Contact",
              slug: "contact",
              content: "Contact information",
              page_type: "Contact",
            },
          ];

          const response = await api.post(
            `/admin/websites/${websiteId}/pages`,
            { pages },
            headers
          );
          
          expect(response.status).toBe(201);
          expect(response.data.pages).toHaveLength(2);
          expect(response.data.pages[0].website_id).toBe(websiteId);
        });
      });

      describe("GET /admin/websites/:id/pages", () => {
        it("should list pages with pagination", async () => {
          const pages = [
            {
              title: "About Us",
              slug: "about",
              content: "About our company",
              page_type: "About",
              status: "Draft",
            },
            {
              title: "Contact",
              slug: "contact",
              content: "Contact information",
              page_type: "Contact",
            },
          ];

          const pageResponse = await api.post(
            `/admin/websites/${websiteId}/pages`,
            {pages},
            headers
          );

          const response = await api.get(
            `/admin/websites/${websiteId}/pages?limit=10&offset=0`,
            headers
          );

          expect(response.status).toBe(200);
          expect(response.data.pages.length).toBeGreaterThanOrEqual(1);
          expect(response.data.count).toBeGreaterThanOrEqual(1);
        });

        it("should filter pages by status", async () => {
          const response = await api.get(
            `/admin/websites/${websiteId}/pages?status=Draft`,
            headers
          );
          
          expect(response.status).toBe(200);
          expect(response.data.pages.every(p => p.status === "Draft")).toBe(true);
        });
      });

      describe("PUT /admin/websites/:id/pages/:pageId", () => {
        beforeEach(async () => {
          // Create a test page for update operations
          const newPage = {
            title: "Test Page",
            slug: "test",
            content: "Test content",
            page_type: "Custom",
            status: "Draft",
          };

          const response = await api.post(
            `/admin/websites/${websiteId}/pages`,
            newPage,
            headers
          );
          pageId = response.data.page.id;
        });

        it("should update a page", async () => {
          const updateData = {
            title: "Updated Home Page",
            status: "Published",
            published_at: new Date().toISOString(),
          };

          const response = await api.put(
            `/admin/websites/${websiteId}/pages/${pageId}`,
            updateData,
            headers
          );
          
          expect(response.status).toBe(200);
          expect(response.data.page.title).toBe(updateData.title);
          expect(response.data.page.status).toBe(updateData.status);
        });
      });

      describe("DELETE /admin/websites/:id/pages/:pageId", () => {
        beforeEach(async () => {
          // Create a test page for delete operations
          const newPage = {
            title: "Page to Delete",
            slug: "delete-me",
            content: "This page will be deleted",
            page_type: "Custom",
            status: "Draft",
          };

          const response = await api.post(
            `/admin/websites/${websiteId}/pages`,
            newPage,
            headers
          );
          pageId = response.data.page.id;
        });

        
        it("should delete a page", async () => {
          const response = await api.delete(
            `/admin/websites/${websiteId}/pages/${pageId}`,
            headers
          );
          
          expect(response.status).toBe(200);
          expect(response.data.deleted).toBe(true);

          // Verify page is deleted
          const getResponse = await api.get(
            `/admin/websites/${websiteId}/pages/${pageId}`,
            headers
          ).catch(e => e.response);
          
          expect(getResponse.status).toBe(404);
        });
      });
    });

    describe("DELETE /admin/websites/:id", () => {
      it("should delete a website and its pages", async () => {
        const response = await api.delete(`/admin/websites/${websiteId}`, headers);
        expect(response.status).toBe(200);
        expect(response.data.deleted).toBe(true);

        // Verify website is deleted
        const getResponse = await api.get(`/admin/websites/${websiteId}`, headers).catch(e => e.response);
        expect(getResponse.status).toBe(404);
      });
    });
  }
});
