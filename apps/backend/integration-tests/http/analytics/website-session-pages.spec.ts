import { setupSharedTestSuite } from "../shared-test-setup";
import { createAdminUser, getAuthHeaders } from "../../helpers/create-admin-user";

jest.setTimeout(100000);

setupSharedTestSuite(({ api, getContainer }) => {
  describe("GET /admin/websites/:id/analytics/pages — entry/exit pages (#569 S2)", () => {
    let websiteId: string;
    let adminHeaders: { headers: Record<string, string> };

    beforeAll(async () => {
      const container = await getContainer();
      await createAdminUser(container);
      adminHeaders = await getAuthHeaders(api);
    });

    beforeEach(async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const website = await websiteService.createWebsites({
        domain: `pages-${Date.now()}.example.com`,
        name: "Session Pages Site",
        status: "Active",
        primary_language: "en",
      });
      websiteId = website.id;

      const analyticsService = container.resolve("custom_analytics");
      const now = new Date();

      await analyticsService.createAnalyticsSessions([
        {
          website_id: websiteId,
          session_id: "s1",
          visitor_id: "v1",
          entry_page: "/",
          exit_page: "/checkout",
          started_at: now,
          last_activity_at: now,
        },
        {
          website_id: websiteId,
          session_id: "s2",
          visitor_id: "v2",
          entry_page: "/",
          exit_page: "/checkout",
          started_at: now,
          last_activity_at: now,
        },
        {
          website_id: websiteId,
          session_id: "s3",
          visitor_id: "v3",
          entry_page: "/pricing",
          exit_page: null,
          started_at: now,
          last_activity_at: now,
        },
      ]);
    });

    it("returns ranked entry and exit page breakdowns by default", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/pages`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.website_id).toBe(websiteId);

      const entry = res.data.pages.entry_page;
      expect(entry.dimension).toBe("entry_page");
      expect(entry.total_sessions).toBe(3);
      expect(entry.results[0]).toMatchObject({
        value: "/",
        count: 2,
        unique_visitors: 2,
        percentage: 67,
      });
      expect(entry.results[1]).toMatchObject({ value: "/pricing", count: 1 });

      const exit = res.data.pages.exit_page;
      expect(exit.dimension).toBe("exit_page");
      expect(exit.total_sessions).toBe(3);
      expect(exit.results.find((r: any) => r.value === "/checkout").count).toBe(2);
      // null exit folds into (none)
      expect(exit.results.find((r: any) => r.value === "(none)").count).toBe(1);
    });

    it("scopes to a single dimension when ?dimension= is passed", async () => {
      const res = await api.get(
        `/admin/websites/${websiteId}/analytics/pages?dimension=entry_page`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.pages.entry_page).toBeDefined();
      expect(res.data.pages.exit_page).toBeUndefined();
    });

    it("400s on an unknown dimension", async () => {
      const res = await api
        .get(
          `/admin/websites/${websiteId}/analytics/pages?dimension=bogus`,
          adminHeaders
        )
        .catch((e: any) => e.response);
      expect(res.status).toBe(400);
      expect(res.data.supported_dimensions).toEqual(["entry_page", "exit_page"]);
    });

    it("returns zeroed breakdowns for a website with no sessions", async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const empty = await websiteService.createWebsites({
        domain: `pages-empty-${Date.now()}.example.com`,
        name: "Empty Pages Site",
        status: "Active",
        primary_language: "en",
      });

      const res = await api.get(
        `/admin/websites/${empty.id}/analytics/pages`,
        adminHeaders
      );
      expect(res.status).toBe(200);
      expect(res.data.pages.entry_page.total_sessions).toBe(0);
      expect(res.data.pages.entry_page.results).toEqual([]);
      expect(res.data.pages.exit_page.total_sessions).toBe(0);
    });
  });
});
