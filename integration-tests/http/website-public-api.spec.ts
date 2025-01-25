import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { error } from "console";

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
  }  
})