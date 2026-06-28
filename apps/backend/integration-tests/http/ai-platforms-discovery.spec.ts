import { createAdminUser, getAuthHeaders } from "../helpers/create-admin-user"
import { getSharedTestEnv, setupSharedTestSuite } from "./shared-test-setup"
import { SOCIALS_MODULE } from "../../src/modules/socials"

jest.setTimeout(60000)

/**
 * Overall integration test for the AI-platform discovery endpoint
 * (GET /admin/ai/platforms) — the "category sweep" that powers role→model
 * resolution and the visual-flow role picker. Verifies that configured
 * category=ai External Platforms are discovered, grouped by metadata.role, and
 * summarised (provider / model / default / has-key) — including a brand-new
 * custom role with no code change.
 */
setupSharedTestSuite(() => {
  let headers: any
  const { api, getContainer } = getSharedTestEnv()

  const seedAiPlatform = async (row: {
    name: string
    role: string
    provider_type: string
    default_model?: string
    is_default?: boolean
    api_key?: string
  }) => {
    const socials: any = getContainer().resolve(SOCIALS_MODULE)
    await socials.createSocialPlatforms([
      {
        name: row.name,
        category: "ai",
        auth_type: "bearer",
        status: "active",
        api_config: {
          ...(row.api_key ? { api_key: row.api_key } : {}),
          ...(row.default_model ? { default_model: row.default_model } : {}),
        },
        metadata: {
          provider_type: row.provider_type,
          role: row.role,
          is_default: !!row.is_default,
        },
      },
    ])
  }

  beforeEach(async () => {
    await createAdminUser(getContainer())
    headers = await getAuthHeaders(api)
  })

  describe("GET /admin/ai/platforms", () => {
    it("returns an empty-but-shaped catalog when no AI platforms are configured", async () => {
      const res = await api.get("/admin/ai/platforms", headers)
      expect(res.status).toBe(200)
      expect(res.data).toHaveProperty("catalog")
      expect(res.data).toHaveProperty("by_role")
      expect(res.data).toHaveProperty("roles")
      expect(Array.isArray(res.data.catalog)).toBe(true)
      expect(Array.isArray(res.data.roles)).toBe(true)
    })

    it("discovers configured AI platforms grouped by role with provider/model/default/key", async () => {
      await seedAiPlatform({
        name: "Test DashScope chat",
        role: "ai_search_chat",
        provider_type: "dashscope",
        default_model: "qwen-plus",
        is_default: true,
        api_key: "sk-test-key",
      })
      await seedAiPlatform({
        name: "Test Cloudflare newsletter",
        role: "ai_newsletter_drafter",
        provider_type: "cloudflare",
        default_model: "@cf/meta/llama-3.1-8b-instruct",
        api_key: "cf-test-key",
      })

      const res = await api.get("/admin/ai/platforms", headers)
      expect(res.status).toBe(200)

      const { roles, by_role, catalog } = res.data
      expect(roles).toEqual(expect.arrayContaining(["ai_search_chat", "ai_newsletter_drafter"]))

      const chat = by_role["ai_search_chat"]?.[0]
      expect(chat).toMatchObject({
        role: "ai_search_chat",
        providerType: "dashscope",
        defaultModel: "qwen-plus",
        isDefault: true,
        status: "active",
        hasApiKey: true,
      })

      const draft = by_role["ai_newsletter_drafter"]?.[0]
      expect(draft).toMatchObject({
        role: "ai_newsletter_drafter",
        providerType: "cloudflare",
        defaultModel: "@cf/meta/llama-3.1-8b-instruct",
        hasApiKey: true,
      })

      // Every catalog entry carries the summarised shape the role picker reads.
      for (const entry of catalog) {
        expect(entry).toHaveProperty("platformId")
        expect(entry).toHaveProperty("role")
        expect(entry).toHaveProperty("providerType")
        expect(entry).toHaveProperty("hasApiKey")
      }
    })

    it("auto-discovers a brand-new custom role with no code change", async () => {
      await seedAiPlatform({
        name: "Test custom-role platform",
        role: "ai_my_custom_role",
        provider_type: "dashscope",
        default_model: "qwen-turbo",
        api_key: "k",
      })

      const res = await api.get("/admin/ai/platforms", headers)
      expect(res.status).toBe(200)
      expect(res.data.roles).toContain("ai_my_custom_role")
      expect(res.data.by_role["ai_my_custom_role"][0].providerType).toBe("dashscope")
    })
  })
})
