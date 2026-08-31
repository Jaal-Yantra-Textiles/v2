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

describe("buildApiConfig — shipping", () => {
  it("builds the ShipGlobal Basic-auth blob (username/password/service)", () => {
    const config = buildApiConfig("shipping", {
      provider_type: "shipglobal",
      mode: "live",
      username: "ship@example.com",
      password: "secret",
      service: "sgdirecteuyun",
    })
    expect(config).toEqual({
      provider: "shipglobal",
      mode: "live",
      username: "ship@example.com",
      password: "secret",
      service: "sgdirecteuyun",
    })
  })

  it("omits a blank service code so the edit overlay keeps the stored value", () => {
    const config = buildApiConfig("shipping", {
      provider_type: "shipglobal",
      username: "ship@example.com",
      password: "secret",
      service: "",
    })
    expect(config).not.toHaveProperty("service")
    expect(config.username).toBe("ship@example.com")
  })

  it("still builds the Shiprocket email/password blob", () => {
    const config = buildApiConfig("shipping", {
      provider_type: "shiprocket",
      email: "ship@example.com",
      password: "secret",
      pickup_location: "Primary",
    })
    expect(config.provider).toBe("shiprocket")
    expect(config.email).toBe("ship@example.com")
    expect(config).not.toHaveProperty("api_key")
  })
})

describe("inferAuthType — shipping", () => {
  it("uses basic auth for ShipGlobal and Shiprocket, api_key otherwise", () => {
    expect(inferAuthType("shipping", "shipglobal")).toBe("basic")
    expect(inferAuthType("shipping", "shiprocket")).toBe("basic")
    expect(inferAuthType("shipping", "dhl")).toBe("api_key")
    expect(inferAuthType("shipping", "delhivery")).toBe("api_key")
  })
})
