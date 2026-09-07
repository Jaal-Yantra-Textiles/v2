import { setupSharedTestSuite } from "../shared-test-setup";

jest.setTimeout(100000);

/**
 * The contract for a tracking request that cannot be honoured.
 *
 * Replicates the prod log noise — ~175/week of error-level entries produced by
 * bots POSTing an empty body to the three public tracking endpoints — and pins
 * the behaviour that replaced it:
 *
 *   malformed request  → 400, one warn line, no stack, no zod dump
 *   unexpected failure → 200 + error level (unchanged; a broken write path must
 *                        never surface on a customer's storefront)
 *
 * 🔴 These endpoints are called by trackers that DO NOT live in this repo, so
 * this spec is the only place the wire contract is written down. Changing a
 * status code here changes it for clients we cannot grep.
 */
setupSharedTestSuite(({ api, getContainer }) => {
  describe("Web tracking endpoints — the malformed-request contract", () => {
    const ENDPOINTS = [
      { path: "/web/analytics/track", label: "analytics" },
      { path: "/web/ad-planning/track-journey", label: "journey" },
      { path: "/web/ad-planning/track-conversion", label: "conversion" },
    ];

    // A 400 must reach us as a response, not as a thrown axios error.
    const post = (path: string, body?: unknown) =>
      api.post(path, body, { validateStatus: () => true } as any);

    describe.each(ENDPOINTS)("$label", ({ path }) => {
      it("answers an empty body with 400 rather than a cheerful 200", async () => {
        const res = await post(path, {});

        expect(res.status).toBe(400);
        expect(res.data.success).toBe(false);
        expect(res.data.message).toBe("Invalid tracking payload");
      });

      it("answers a bodiless POST the same way", async () => {
        const res = await post(path);
        expect(res.status).toBe(400);
        expect(res.data.success).toBe(false);
      });

      it("names the missing fields so a tracker can be fixed", async () => {
        const res = await post(path, {});

        expect(Array.isArray(res.data.fields)).toBe(true);
        expect(res.data.fields).toContain("website_id");
      });

      it("does not leak a zod dump or a stack to the client", async () => {
        const res = await post(path, {});
        const body = JSON.stringify(res.data);

        expect(body).not.toContain("ZodError");
        expect(body).not.toContain("invalid_type");
        expect(body).not.toContain("at Object.");
        expect(res.data.issues).toBeUndefined();
        expect(res.data.stack).toBeUndefined();
      });

      it("rejects a non-object body without throwing", async () => {
        const res = await post(path, "not-an-object");
        expect(res.status).toBe(400);
      });
    });

    /**
     * The case the old code hid: a REAL storefront whose tracker booted before
     * `website_id` resolved got `success: true` and was indistinguishable from
     * a bot. It must now be told.
     */
    it("tells a tracker that lost its website_id, instead of claiming success", async () => {
      const res = await post("/web/analytics/track", {
        event_type: "pageview",
        pathname: "/shop",
        visitor_id: "visitor_real_client",
        session_id: "session_real_client",
      });

      expect(res.status).toBe(400);
      expect(res.data.fields).toContain("website_id");
    });
  });

  /**
   * The half that must NOT change. A valid payload still tracks, and a website
   * id that simply does not exist is OUR problem to absorb, not the caller's —
   * it passes validation and fails downstream, so it keeps the 200 swallow.
   */
  describe("Web tracking endpoints — the happy path is unaffected", () => {
    it("still tracks a well-formed event", async () => {
      const container = await getContainer();
      const websiteService = container.resolve("websites");
      const website = await websiteService.createWebsites({
        domain: "test-tracking-contract.example.com",
        name: "Tracking Contract Site",
        status: "Active",
        primary_language: "en",
      });

      const res = await api.post("/web/analytics/track", {
        website_id: website.id,
        event_type: "pageview",
        pathname: "/still-works",
        visitor_id: "visitor_contract",
        session_id: "session_contract",
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });

    it("absorbs a well-formed event for an unknown website as OURS (200, not 400)", async () => {
      const res = await api.post(
        "/web/analytics/track",
        {
          website_id: "web_does_not_exist_at_all",
          event_type: "pageview",
          pathname: "/unknown-site",
          visitor_id: "visitor_unknown",
          session_id: "session_unknown",
        },
        { validateStatus: () => true } as any
      );

      // Passes validation, fails downstream — the swallow branch, unchanged.
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
    });
  });
});
