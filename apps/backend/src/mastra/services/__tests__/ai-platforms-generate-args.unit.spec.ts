import { buildGenerateArgs } from "../ai-platforms"

describe("buildGenerateArgs", () => {
  it("keeps the native system param for openrouter", () => {
    const a = buildGenerateArgs({ providerType: "openrouter" }, "be terse", "hi")
    expect(a).toEqual({ system: "be terse", messages: [{ role: "user", content: "hi" }] })
  })

  it("omits the system key for openrouter when system is empty/whitespace", () => {
    expect(buildGenerateArgs({ providerType: "openrouter" }, "", "hi")).toEqual({
      messages: [{ role: "user", content: "hi" }],
    })
    expect(buildGenerateArgs({ providerType: "openrouter" }, "   ", "hi")).toEqual({
      messages: [{ role: "user", content: "hi" }],
    })
  })

  it("folds system into the user message for OpenAI-compatible providers (no system key)", () => {
    for (const providerType of ["cloudflare", "dashscope", "vercel_ai_gateway", "custom"] as const) {
      expect(buildGenerateArgs({ providerType }, "be terse", "hi")).toEqual({
        messages: [{ role: "user", content: "be terse\n\nhi" }],
      })
    }
  })

  it("sends only the prompt when there is no system text (compat path)", () => {
    expect(buildGenerateArgs({ providerType: "cloudflare" }, undefined, "hi")).toEqual({
      messages: [{ role: "user", content: "hi" }],
    })
  })

  it("never emits a system-role message for the compat path (the live minimax failure)", () => {
    const a = buildGenerateArgs({ providerType: "cloudflare" }, "sys", "user")
    expect("system" in a).toBe(false)
    expect(a.messages.every((m) => m.role === "user")).toBe(true)
  })
})
