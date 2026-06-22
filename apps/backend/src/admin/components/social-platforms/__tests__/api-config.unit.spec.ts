import { buildApiConfig, inferAuthType } from "../api-config"

describe("buildApiConfig — ai", () => {
  it("builds the AI connection blob without a `provider` key (provider_type lives in metadata)", () => {
    const config = buildApiConfig("ai", {
      provider_type: "cloudflare",
      api_key: "sk-test",
      default_model: "@cf/zai-org/glm-4.7-flash",
      account_id: "acct_123",
    })
    expect(config).toEqual({
      api_key: "sk-test",
      default_model: "@cf/zai-org/glm-4.7-flash",
      account_id: "acct_123",
    })
    // Crucially: no `provider` key (would drift from the create path).
    expect(config).not.toHaveProperty("provider")
  })

  it("drops blank/undefined fields so an edit overlay never clobbers set values", () => {
    const config = buildApiConfig("ai", {
      provider_type: "openrouter",
      api_key: "", // blank secret → omitted, restored server-side
      default_model: "meta-llama/llama-3.3-70b-instruct:free",
      account_id: undefined,
      base_url: "",
    })
    expect(config).toEqual({
      default_model: "meta-llama/llama-3.3-70b-instruct:free",
    })
  })

  it("keeps base_url for gateway/custom providers", () => {
    const config = buildApiConfig("ai", {
      provider_type: "vercel_ai_gateway",
      api_key: "sk-test",
      base_url: "https://gateway.example.com/v1",
    })
    expect(config).toEqual({
      api_key: "sk-test",
      base_url: "https://gateway.example.com/v1",
    })
  })
})

describe("inferAuthType — ai", () => {
  it("returns bearer for the ai category regardless of provider", () => {
    expect(inferAuthType("ai", "cloudflare")).toBe("bearer")
    expect(inferAuthType("ai", "openrouter")).toBe("bearer")
    expect(inferAuthType("ai", undefined)).toBe("bearer")
  })
})
