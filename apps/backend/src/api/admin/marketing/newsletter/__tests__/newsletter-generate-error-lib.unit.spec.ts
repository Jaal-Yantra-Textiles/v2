import {
  buildNoOutputError,
  NO_PROVIDER_CONFIGURED_MESSAGE,
} from "../newsletter-generate-error-lib"

describe("buildNoOutputError", () => {
  it("(a) no provider resolved AND no env key → keeps the configure-a-provider message", () => {
    expect(
      buildNoOutputError({ providerResolved: false, hasEnvKey: false })
    ).toBe(NO_PROVIDER_CONFIGURED_MESSAGE)
  })

  it("(b) provider resolved but threw → names providerType/model + the real error", () => {
    expect(
      buildNoOutputError({
        providerResolved: true,
        providerType: "dashscope",
        model: "qwen3.7-plus",
        error: "rate limited",
        hasEnvKey: false,
      })
    ).toBe(
      "AI provider (dashscope/qwen3.7-plus) returned no output: rate limited"
    )
  })

  it("(b) provider resolved, no throw, empty output → reports 'no text in response'", () => {
    // The motivating case: a DashScope "thinking" model returns empty result.text.
    expect(
      buildNoOutputError({
        providerResolved: true,
        providerType: "dashscope",
        model: "qwen3.7-plus",
        hasEnvKey: false,
      })
    ).toBe(
      "AI provider (dashscope/qwen3.7-plus) returned no output: no text in response"
    )
  })

  it("(b) falls back to default/unknown labels when type/model missing", () => {
    expect(
      buildNoOutputError({ providerResolved: true, hasEnvKey: false })
    ).toBe("AI provider (unknown/default) returned no output: no text in response")
  })

  it("(b) env-fallback path (no platform but env key set) reports openrouter/env", () => {
    expect(
      buildNoOutputError({
        providerResolved: false,
        hasEnvKey: true,
        error: "401 unauthorized",
      })
    ).toBe("AI provider (openrouter/env) returned no output: 401 unauthorized")
  })
})
