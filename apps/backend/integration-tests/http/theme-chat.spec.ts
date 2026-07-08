/**
 * Integration test for POST /partners/storefront/website/theme/chat (#339).
 *
 * Headless (no external LLM calls):
 *   1. Unauthenticated POST → 401.
 *   2. No provider configured (free fallback, no OPENROUTER_API_KEY) → 503.
 *   3. safeThemePatchSchema rejects out-of-allowlist keys + javascript: URLs.
 */

import { safeThemePatchSchema } from "../../src/api/partners/storefront/website/theme/safe-patch-schema"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { createAdminUser } from "../helpers/create-admin-user"

const TEST_PARTNER_PASSWORD = "supersecret"
const SAVED_OPENROUTER_KEY = process.env.OPENROUTER_API_KEY

jest.setTimeout(60 * 1000)

setupSharedTestSuite(() => {
  const { api, getContainer } = getSharedTestEnv()
  let partnerHeaders: Record<string, string>
  let partnerId: string

  beforeEach(async () => {
    const container = getContainer()
    await createAdminUser(container)

    // Create a partner with a website (same pattern as theme-merge.spec.ts)
    const unique = Date.now()
    const partnerEmail = `chat-test-${unique}@medusa-test.com`
    const domain = `chat-test-${unique}.test.com`

    await api.post("/auth/partner/emailpass/register", {
      email: partnerEmail,
      password: TEST_PARTNER_PASSWORD,
    })

    const login1 = await api.post("/auth/partner/emailpass", {
      email: partnerEmail,
      password: TEST_PARTNER_PASSWORD,
    })
    partnerHeaders = { Authorization: `Bearer ${login1.data.token}` }

    const createRes = await api.post(
      "/partners",
      {
        name: `Chat Test ${unique}`,
        handle: `chat-test-${unique}`,
        admin: {
          email: partnerEmail,
          first_name: "Chat",
          last_name: "Test",
        },
      },
      { headers: partnerHeaders }
    )
    partnerId = createRes.data.partner.id

    // Re-login to get auth context with partner_id
    const login2 = await api.post("/auth/partner/emailpass", {
      email: partnerEmail,
      password: TEST_PARTNER_PASSWORD,
    })
    partnerHeaders = { Authorization: `Bearer ${login2.data.token}` }

    // Create + link a website
    const websiteService = container.resolve("websites") as any
    const website = await websiteService.createWebsites({
      domain,
      name: `Chat Test Site ${unique}`,
    })

    const partnerService = container.resolve("partner") as any
    await partnerService.updatePartners({
      selector: { id: partnerId },
      data: {
        storefront_domain: domain,
        website_id: website.id,
      },
    })

    // Restore env in case a previous test deleted it
    if (SAVED_OPENROUTER_KEY !== undefined) {
      process.env.OPENROUTER_API_KEY = SAVED_OPENROUTER_KEY
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  })

  afterAll(() => {
    if (SAVED_OPENROUTER_KEY !== undefined) {
      process.env.OPENROUTER_API_KEY = SAVED_OPENROUTER_KEY
    } else {
      delete process.env.OPENROUTER_API_KEY
    }
  })

  const validBody = {
    messages: [
      {
        role: "user",
        parts: [{ type: "text", text: "Make the header sticky" }],
      },
    ],
  }

  describe("POST /partners/storefront/website/theme/chat (#339)", () => {
    it("should return 401 when unauthenticated", async () => {
      const res = await api
        .post("/partners/storefront/website/theme/chat", validBody)
        .catch((e: any) => e.response)

      expect(res.status).toBe(401)
    })

    it("should return 503 when no provider is configured", async () => {
      // No platform in the fresh test DB → resolveRoleTextModel returns
      // { source: "free" }. With no OPENROUTER_API_KEY, the route should
      // return the actionable 503 (not a 502).
      delete process.env.OPENROUTER_API_KEY

      const res = await api
        .post(
          "/partners/storefront/website/theme/chat",
          validBody,
          { headers: partnerHeaders }
        )
        .catch((e: any) => e.response)

      expect(res.status).toBe(503)
      expect(res.data.error).toContain("not configured")
    })
  })

  describe("safeThemePatchSchema (#339 / #7)", () => {
    it("strips unknown top-level sections (no passthrough)", () => {
      const input = { unknown_section: { foo: "bar" }, colors: { primary: "#ff0000" } }
      const result = safeThemePatchSchema.safeParse(input)
      expect(result.success).toBe(true)
      expect(result.data!.unknown_section as any).toBeUndefined()
      expect(result.data!.colors?.primary).toBe("#ff0000")
    })

    it("strips unknown keys in known sections", () => {
      const input = { colors: { unknown_color: "#ff0000", primary: "#ff0000" } }
      const result = safeThemePatchSchema.safeParse(input)
      expect(result.success).toBe(true)
      expect((result.data!.colors as any)?.unknown_color).toBeUndefined()
      expect(result.data!.colors?.primary).toBe("#ff0000")
    })

    it("rejects javascript: URLs in cta_link (injection guard)", () => {
      const bad = { hero: { cta_link: "javascript:alert(1)" } }
      expect(safeThemePatchSchema.safeParse(bad).success).toBe(false)
    })

    it("rejects data: URLs in image fields", () => {
      const bad = { hero: { background_image_url: "data:text/html,<script>" } }
      expect(safeThemePatchSchema.safeParse(bad).success).toBe(false)
    })

    it("accepts a valid patch with widened allowlist", () => {
      const good = {
        colors: { primary: "#ff0000" },
        navigation: { sticky: true },
        home_sections: {
          featured_collection_count: 6,
          products_per_collection: 4,
          empty_state_product_name: "Sample Product",
          sections_order: ["hero", "collections", "categories"],
        },
      }
      expect(safeThemePatchSchema.safeParse(good).success).toBe(true)
    })

    it("accepts root-relative URLs in cta_link", () => {
      const good = { hero: { cta_link: "/products" } }
      expect(safeThemePatchSchema.safeParse(good).success).toBe(true)
    })
  })
})
