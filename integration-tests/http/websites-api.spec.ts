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
          expect(response.data.message).toBeDefined();
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

        it("should handle bulk page creation with duplicates", async () => {
          // First create some initial pages
          const initialPages = {
            pages: [
              {
                title: "Home",
                slug: "home",
                content: "Welcome to Test Website",
                page_type: "Home",
                status: "Published"
              },
              {
                title: "About",
                slug: "about",
                content: "About Test Website",
                page_type: "About",
                status: "Published"
              }
            ]
          };

          // Create initial pages
          const initialResponse = await api.post(
            `/admin/websites/${websiteId}/pages`,
            initialPages,
            headers
          );
          expect(initialResponse.status).toBe(201);
          expect(initialResponse.data.message).toBe("All pages created successfully");
          expect(initialResponse.data.pages).toHaveLength(2);

          // Try to create mix of new and duplicate pages
          const mixedPages = {
            pages: [
              {
                title: "Home",  // Duplicate
                slug: "home",
                content: "Updated Home Content",
                page_type: "Home",
                status: "Published"
              },
              {
                title: "About", // Duplicate
                slug: "about",
                content: "Updated About Content",
                page_type: "About",
                status: "Published"
              },
              {
                title: "Contact", // New
                slug: "contact",
                content: "Contact Us",
                page_type: "Contact",
                status: "Published"
              },
              {
                title: "Products", // New
                slug: "products",
                content: "Our Products",
                page_type: "Custom",
                status: "Published"
              }
            ]
          };

          const mixedResponse = await api.post(
            `/admin/websites/${websiteId}/pages`,
            mixedPages,
            headers
          );

          // Should return 207 for partial success
          expect(mixedResponse.status).toBe(207);
          expect(mixedResponse.data.message).toBe("Some pages were created successfully while others failed");
          
          // Should have created the new pages
          expect(mixedResponse.data.pages).toHaveLength(2);
          expect(mixedResponse.data.pages.map(p => p.slug)).toContain("contact");
          expect(mixedResponse.data.pages.map(p => p.slug)).toContain("products");
          
          // Should have errors for duplicate pages
          expect(mixedResponse.data.errors).toHaveLength(2);
          expect(mixedResponse.data.errors).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                slug: "home",
                error: expect.stringContaining("already exists")
              }),
              expect.objectContaining({
                slug: "about",
                error: expect.stringContaining("already exists")
              })
            ])
          );
        });

        it("should handle all duplicate pages gracefully", async () => {
          // First create some initial pages
          const initialPages = {
            pages: [
              {
                title: "Home",
                slug: "home",
                content: "Welcome to Test Website",
                page_type: "Home",
                status: "Published"
              }
            ]
          };

          // Create initial page
          const initialResponse = await api.post(
            `/admin/websites/${websiteId}/pages`,
            initialPages,
            headers
          );
  
          expect(initialResponse.status).toBe(201);

          // Try to create the same page again
          const duplicateResponse = await api.post(
            `/admin/websites/${websiteId}/pages`,
            initialPages,
            headers
          ).catch(e => e.response);

          // Should return 400 for complete failure
          expect(duplicateResponse.status).toBe(400);
          expect(duplicateResponse.data.message).toBe("Failed to create pages");
          expect(duplicateResponse.data.errors).toHaveLength(1);
          expect(duplicateResponse.data.errors[0]).toEqual(
            expect.objectContaining({
              slug: "home",
              error: expect.stringContaining("already exists")
            })
          );
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
            published_at: new Date("2025-02-22T15:15:49.000Z"),
          };

          const response = await api.put(
            `/admin/websites/${websiteId}/pages/${pageId}`,
            updateData,
            headers
          ).catch(error => {
            console.log('API Error Response:', error.response?.data);
            return error.response;
          });

          expect(response.status).toBe(200);
          expect(response.data.page).toBeDefined();
          expect(response.data.page.title).toBe(updateData.title);
          expect(response.data.page.status).toBe(updateData.status);
          expect(new Date(response.data.page.published_at)).toEqual(updateData.published_at);
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
