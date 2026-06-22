import {
  CF_FREE_MODEL_EXAMPLE,
  CF_NATIVE_PREFIX,
  getCloudflareModelWarning,
} from "../cloudflare-model-warning"

describe("getCloudflareModelWarning", () => {
  it("returns null for non-cloudflare providers regardless of model", () => {
    expect(getCloudflareModelWarning("openrouter", "minimax/m3")).toBeNull()
    expect(getCloudflareModelWarning("dashscope", "qwen-turbo")).toBeNull()
    expect(getCloudflareModelWarning("custom", "anything")).toBeNull()
    expect(getCloudflareModelWarning(null, "minimax/m3")).toBeNull()
    expect(getCloudflareModelWarning(undefined, "minimax/m3")).toBeNull()
  })

  it("returns null for cloudflare with an empty / whitespace model (provider default is used)", () => {
    expect(getCloudflareModelWarning("cloudflare", "")).toBeNull()
    expect(getCloudflareModelWarning("cloudflare", "   ")).toBeNull()
    expect(getCloudflareModelWarning("cloudflare", null)).toBeNull()
    expect(getCloudflareModelWarning("cloudflare", undefined)).toBeNull()
  })

  it("returns null for cloudflare with a native @cf/ model", () => {
    expect(getCloudflareModelWarning("cloudflare", CF_FREE_MODEL_EXAMPLE)).toBeNull()
    expect(
      getCloudflareModelWarning("cloudflare", "@cf/baai/bge-base-en-v1.5")
    ).toBeNull()
    expect(
      getCloudflareModelWarning("cloudflare", "@cf/meta/llama-3.3-70b-instruct-fp8-fast")
    ).toBeNull()
  })

  it("trims surrounding whitespace before the @cf/ check", () => {
    expect(
      getCloudflareModelWarning("cloudflare", `  ${CF_FREE_MODEL_EXAMPLE}  `)
    ).toBeNull()
  })

  it("warns for cloudflare with a non-native model id", () => {
    const warning = getCloudflareModelWarning("cloudflare", "minimax/m3")
    expect(warning).not.toBeNull()
    expect(warning).toContain("minimax/m3")
    expect(warning).toContain(CF_NATIVE_PREFIX)
    expect(warning).toContain("Insufficient balance")
  })

  it("warns for a model that merely contains but does not start with @cf/", () => {
    expect(getCloudflareModelWarning("cloudflare", "vendor/@cf/x")).not.toBeNull()
    expect(getCloudflareModelWarning("cloudflare", "cf/meta/llama")).not.toBeNull()
  })
})
