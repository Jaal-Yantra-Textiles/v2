// Mock the OpenRouter provider so the free-vision fallback never hits the
// network during unit tests (getVisionModelId() otherwise fetches the live
// OpenRouter model list).
jest.mock("../../providers/openrouter", () => ({
  getVisionModelId: async () => "free/vision-model:free",
}))

import { resolveRoleVisionModel } from "../ai-platforms"

describe("resolveRoleVisionModel (#769)", () => {
  it("falls back to the free OpenRouter vision model when no platform resolves", async () => {
    // container.resolve throws → getAiPlatformForRole returns null → free fallback
    const container = {
      resolve: () => {
        throw new Error("no socials module")
      },
    } as any
    const out = await resolveRoleVisionModel(container, "ai_image_extraction")
    expect(out.source).toBe("free")
    expect(out.providerType).toBe("openrouter")
    expect(out.modelId).toBe("free/vision-model:free")
    expect(out.model).toBeDefined()
    expect(out.platformId).toBeUndefined()
  })

  it("resolves the admin-configured platform when it is the active default for the role", async () => {
    const container = {
      resolve: () => ({
        listSocialPlatforms: async (filters: any) => {
          // resolver filters on category=ai + status=active + metadata.role
          expect(filters.category).toBe("ai")
          expect(filters.status).toBe("active")
          expect(filters.metadata?.role).toBe("ai_image_extraction")
          return [
            {
              id: "01PLT",
              status: "active",
              base_url: "https://gateway.example/v1",
              metadata: {
                role: "ai_image_extraction",
                provider_type: "vercel_ai_gateway",
                is_default: true,
              },
              api_config: { api_key: "sk-test", default_model: "openai/gpt-4o-mini" },
            },
          ]
        },
      }),
    } as any
    const out = await resolveRoleVisionModel(container, "ai_image_extraction")
    expect(out.source).toBe("platform")
    expect(out.providerType).toBe("vercel_ai_gateway")
    expect(out.platformId).toBe("01PLT")
    expect(out.modelId).toBe("openai/gpt-4o-mini")
    expect(out.model).toBeDefined()
  })
})
