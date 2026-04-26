import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user";
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup";

jest.setTimeout(30000);

setupSharedTestSuite(() =>{

    let headers;
    let websiteId;
    const { api , getContainer } = getSharedTestEnv();
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
  
      // Create test pages and blog pages with different statuses
      const pages = [
        // Website pages
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
        // Blog pages
        {
          title: "Published Blog 1",
          slug: "blog-1",
          content: "First blog post!",
          page_type: "Blog",
          status: "Published",
          published_at: new Date().toISOString(),
        },
        {
          title: "Published Blog 2",
          slug: "blog-2",
          content: "Second blog post!",
          page_type: "Blog",
          status: "Published",
          published_at: new Date(Date.now() - 86400000 * 2).toISOString(), // 2 days ago
        },
        {
          title: "Draft Blog",
          slug: "draft-blog",
          content: "Not published yet",
          page_type: "Blog",
          status: "Draft",
        },
        {
          title: "Archived Blog",
          slug: "archived-blog",
          content: "Old blog post",
          page_type: "Blog",
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
        expect(response.data.message).toBe("The website non-existent.com was not found");
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

    describe("GET /web/website/:domain/blogs", () => {
      it("should return all published blogs", async () => {
        const response = await api.get("/web/website/test-public.example.com/blogs");
        expect(response.status).toBe(200);
        // Check blogs data
        expect(response.data).toBeDefined();
        expect(response.data).toHaveLength(2);

        // Check that both expected blogs are present
        const expectedBlogTitles = ["Published Blog 1", "Published Blog 2"];
        const foundTitles = response.data.map(blog => blog.title);
        expect(foundTitles).toEqual(expect.arrayContaining(expectedBlogTitles));

        // Verify each blog has the required published properties
        response.data.forEach(blog => {
          expect(blog.published_at).toBeDefined();
          expect(blog.status).toBe("Published");
        });
        
        // Verify draft and archived blogs are not included
        const actualBlogTitles = response.data.map(b => b.title);
        expect(actualBlogTitles).not.toContain("Draft Blog");
        expect(actualBlogTitles).not.toContain("Archived Blog");
      });
    });

    describe("GET /web/website/:domain/blogs/:blogId", () => {
      it("should return a published blog by slug", async () => {
        const response = await api.get("/web/website/test-public.example.com/blogs/blog-1");
        expect(response.status).toBe(200);
        expect(response.data.title).toBe("Published Blog 1");
        expect(response.data.slug).toBe("blog-1");
        expect(response.data.status).toBe("Published");
        expect(response.data.page_type).toBe("Blog");
        expect(response.data.published_at).toBeDefined();
        // Should not expose sensitive fields
        expect(response.data).not.toHaveProperty("id");
        expect(response.data).not.toHaveProperty("metadata");
        expect(response.data).not.toHaveProperty("created_at");
        expect(response.data).not.toHaveProperty("updated_at");
      });

      it("should return 404 for draft blog", async () => {
        const response = await api.get("/web/website/test-public.example.com/blogs/draft-blog").catch(e => e.response);
        expect(response.status).toBe(404);
        expect(response.data.message).toMatch(/not found/i);
      });

      it("should return 404 for archived blog", async () => {
        const response = await api.get("/web/website/test-public.example.com/blogs/archived-blog").catch(e => e.response);
        expect(response.status).toBe(404);
        expect(response.data.message).toMatch(/not found/i);
      });

      it("should return 404 for non-existent blog", async () => {
        const response = await api.get("/web/website/test-public.example.com/blogs/does-not-exist").catch(e => e.response);
        expect(response.status).toBe(404);
        expect(response.data.message).toMatch(/not found/i);
      });
    });

    describe("GET /web/website/:domain/:page", () => {
      it("should return 404 for non-existent page", async () => {
        const response = await api
          .get("/web/website/test-public.example.com/non-existent")
          .catch((e) => e.response);
        
        expect(response.status).toBe(404);
        expect(response.data.message).toBe("Page with slug - non-existent not found and if you are trying to access blog page then use the /blogs endpoint");
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
      });

      it("should not return draft pages", async () => {
        const response = await api
          .get("/web/website/test-public.example.com/contact")
          .catch((e) => e.response);
        
        expect(response.status).toBe(404);
        expect(response.data.message).toBe("Page with slug - contact not found and if you are trying to access blog page then use the /blogs endpoint");
      });
    });

    describe("POST /web/website/:domain/subscribe", () => {
      it("should successfully subscribe a person to a website", async () => {
        const subscriptionData = {
          first_name: "Test",
          last_name: "Subscriber",
          email: "test.subscriber@example.com"
        };

        const response = await api.post(
          "/web/website/test-public.example.com/subscribe",
          subscriptionData
        );

        expect(response.status).toBe(200);
        expect(response.data.message).toBe("Subscription successful");

        // Verify the person was created with the subscriber tag
        // First, get admin headers
        const adminHeaders = await getAuthHeaders(api);
        
        // Search for the person by email
        const personsResponse = await api.get(
          `/admin/persons?email=${subscriptionData.email}`,
          adminHeaders
        );

        expect(personsResponse.status).toBe(200);
        expect(personsResponse.data.persons.length).toBeGreaterThan(0);
        
        const person = personsResponse.data.persons[0];
        expect(person.first_name).toBe(subscriptionData.first_name);
        expect(person.last_name).toBe(subscriptionData.last_name);
        expect(person.email).toBe(subscriptionData.email);
        
        // Verify the person has metadata about the subscription
        expect(person.metadata).toHaveProperty("is_subscriber", true);
        expect(person.metadata).toHaveProperty("subscribed_to_website", "Test Public Website");
        expect(person.metadata).toHaveProperty("subscribed_to_domain", "test-public.example.com");
      });

      it("should return 400 for invalid subscription data", async () => {
        const invalidData = {
          // Missing required fields
          email: "invalid@example.com"
        };

        const response = await api.post(
          "/web/website/test-public.example.com/subscribe",
          invalidData
        ).catch(e => e.response);

        expect(response.status).toBe(400);
        expect(response.data).toHaveProperty("message");
      });

      it("should return 404 for non-existent website domain", async () => {
        const subscriptionData = {
          first_name: "Test",
          last_name: "Subscriber",
          email: "test.subscriber2@example.com"
        };

        const response = await api.post(
          "/web/website/non-existent-domain.com/subscribe",
          subscriptionData
        ).catch(e => e.response);

        expect(response.status).toBe(404);
        expect(response.data.message).toBe("The website non-existent-domain.com was not found");
      });
    });
})