import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";

jest.setTimeout(30000);

medusaIntegrationTestRunner({

  testSuite: ({ api, getContainer }) => {
    let headers;
    let websiteId;
  
    beforeEach(async () => {
      const container = getContainer();
      await createAdminUser(container);
      headers = await getAuthHeaders(api);
  
      // Create a test website for all tests
      const newWebsite = {
        domain: "test-public.example.com",
        name: "Test Public Website",
        status: "Active",
      };
  
      const response = await api.post("/admin/websites", newWebsite, headers);
      websiteId = response.data.website.id;
  
      // Create test pages with different statuses
      const pages = [
        {
          title: "Published Home",
          slug: "home",
          content: "Welcome to our site",
          page_type: "Home",
          status: "Published",
          published_at: new Date().toISOString(),
        },
        {
          title: "Published About",
          slug: "about",
          content: "About our company",
          page_type: "About",
          status: "Published",
          published_at: new Date(Date.now() - 86400000).toISOString(), // 1 day ago
        },
        {
          title: "Draft Contact",
          slug: "contact",
          content: "Contact information",
          page_type: "Contact",
          status: "Draft",
        },
        {
          title: "Archived Page",
          slug: "archived",
          content: "Old content",
          page_type: "Custom",
          status: "Archived",
        },
      ];
  
      await api.post(
        `/admin/websites/${websiteId}/pages`,
        { pages },
        headers
      );
    });
  
    describe("GET /web/website/:domain", () => {
      it("should return 404 for non-existent website", async () => {
        const response = await api.get("/web/website/non-existent.com").catch(
          e => e.response
        );
        expect(response.status).toBe(404)
        expect(response.data.message).toBe("Website not found");
      });
  
      it("should return website with only published pages", async () => {
        const response = await api.get("/web/website/test-public.example.com");
        expect(response.status).toBe(200);
        
        // Check website data
        expect(response.data.name).toBe("Test Public Website");
        expect(response.data.domain).toBe("test-public.example.com");
        
        expect(response.data.pages).toBeDefined();
        expect(response.data.pages).toHaveLength(2);

        // Check that both expected pages are present
        const expectedPageTitles = ["Published Home", "Published About"];
        const foundTitles = response.data.pages.map(page => page.title);
        expect(foundTitles).toEqual(expect.arrayContaining(expectedPageTitles));

        // Verify each page has the required published properties
        response.data.pages.forEach(page => {
          expect(page.published_at).toBeDefined();
          expect(page.status).toBe("Published");
        });
        
        // Verify draft and archived pages are not included
        const actualPageTitles = response.data.pages.map(p => p.title);
        expect(actualPageTitles).not.toContain("Draft Contact");
        expect(actualPageTitles).not.toContain("Archived Page");
      });
  
      it("should not expose sensitive website data", async () => {
        const response = await api.get("/web/website/test-public.example.com");
        expect(response.status).toBe(200);
        
        // Verify sensitive fields are not exposed
        expect(response.data).not.toHaveProperty("id");
        expect(response.data).not.toHaveProperty("metadata");
        expect(response.data).not.toHaveProperty("created_at");
        expect(response.data).not.toHaveProperty("updated_at");
        
        // Verify page sensitive fields are not exposed
        const page = response.data.pages[0];
        expect(page).not.toHaveProperty("id");
        expect(page).not.toHaveProperty("metadata");
        expect(page).not.toHaveProperty("created_at");
        expect(page).not.toHaveProperty("updated_at");
      });
    });

    describe("GET /web/website/:domain/:page", () => {
      it("should return 404 for non-existent page", async () => {
        const response = await api
          .get("/web/website/test-public.example.com/non-existent")
          .catch((e) => e.response);
        
        expect(response.status).toBe(404);
        expect(response.data.message).toBe("Page not found");
      });

      it("should return page with blocks in correct order", async () => {
        // First create some blocks for the home page
        const blocks = [
          {
            name: "Hero Section",
            type: "Hero",
            content: { title: "Welcome", subtitle: "To our website" },
            settings: { background: "dark" },
            status: "Active",
            order: 1,
          },
          {
            name: "Features Section",
            type: "Feature",
            content: { features: ["Feature 1", "Feature 2"] },
            settings: { layout: "grid" },
            status: "Active",
            order: 2,
          },
          {
            name: "Header Section",
            type: "Header",
            content: { logo: "logo.png" },
            settings: { sticky: true },
            status: "Active",
            order: 0,
          },
        ];

        // Get the home page ID
        const pagesResponse = await api.get(
          `/admin/websites/${websiteId}/pages`,
          headers
        );
        
        const homePage = pagesResponse.data.pages.find(
          (p) => p.slug === "home"
        );

        // Add blocks to the home page
        await api.post(
          `/admin/websites/${websiteId}/pages/${homePage.id}/blocks`,
          {blocks},
          headers
        )
        // Now fetch the page through the public API
        const response = await api.get(
          "/web/website/test-public.example.com/home"
        );

        expect(response.status).toBe(200);
        
        // Check page data
        expect(response.data.title).toBe("Published Home");
        expect(response.data.slug).toBe("home");
        expect(response.data.status).toBe("Published");
        
        // Check blocks
        expect(response.data.blocks).toHaveLength(3);
        
        // Verify blocks are in correct order
        const blockOrders = response.data.blocks.map((b) => b.order);
        expect(blockOrders).toEqual([0, 1, 2]);

        // Verify block content structure
        const headerBlock = response.data.blocks.find((b) => b.type === "Header");
        expect(headerBlock).toMatchObject({
          type: "Header",
          content: { logo: "logo.png" },
          order: 0,
        });

        // Verify website info is included
        expect(response.data.website).toMatchObject({
          name: "Test Public Website",
          domain: "test-public.example.com",
        });
      });

      it("should not return draft pages", async () => {
        const response = await api
          .get("/web/website/test-public.example.com/contact")
          .catch((e) => e.response);
        
        expect(response.status).toBe(404);
        expect(response.data.message).toBe("Page not found");
      });
    });
  }  
})