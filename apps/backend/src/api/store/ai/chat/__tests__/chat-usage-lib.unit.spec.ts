import { parseChatProvider } from "../chat-usage-lib"

describe("parseChatProvider", () => {
  it("parses a DB-configured platform into source=platform + platformId", () => {
    expect(parseChatProvider("db:dashscope:01KS4SEWZZ")).toEqual({
      providerType: "dashscope",
      source: "platform",
      platformId: "01KS4SEWZZ",
    })
  })

  it("parses an env-fallback provider:model into source=free + modelId", () => {
    expect(parseChatProvider("dashscope:qwen-plus")).toEqual({
      providerType: "dashscope",
      source: "free",
      modelId: "qwen-plus",
    })
  })

  it("parses the openrouter free rotator", () => {
    expect(parseChatProvider("openrouter:free")).toEqual({
      providerType: "openrouter",
      source: "free",
      modelId: "free",
    })
  })

  it("keeps a colon-containing model id intact (e.g. cloudflare / :free suffix)", () => {
    expect(parseChatProvider("cloudflare:@cf/meta/llama-3.1-8b-instruct")).toEqual({
      providerType: "cloudflare",
      source: "free",
      modelId: "@cf/meta/llama-3.1-8b-instruct",
    })
    expect(parseChatProvider("openrouter:meta-llama/llama-3.3-70b-instruct:free").modelId).toBe(
      "meta-llama/llama-3.3-70b-instruct:free"
    )
  })

  it("falls back gracefully on an empty/odd string", () => {
    expect(parseChatProvider("")).toMatchObject({ providerType: "openrouter", source: "free" })
  })
})
