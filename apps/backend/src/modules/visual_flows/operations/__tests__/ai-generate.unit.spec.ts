import { aiGenerateOperation } from "../ai-generate"

describe("aiGenerateOperation", () => {
  it("is defined with the expected type, category and output contract", () => {
    expect(aiGenerateOperation.type).toBe("ai_generate")
    expect(aiGenerateOperation.category).toBe("integration")
    expect((aiGenerateOperation.defaultOptions as any).role).toBe("ai_search_chat")
  })

  it("optionsSchema applies sensible defaults", () => {
    const parsed = aiGenerateOperation.optionsSchema!.parse({ input: "hello" }) as any
    expect(parsed.role).toBe("ai_search_chat")
    expect(parsed.fallback_on_error).toBe(false)
    expect(parsed.input).toBe("hello")
  })

  it("requires input", () => {
    expect(() => aiGenerateOperation.optionsSchema!.parse({})).toThrow()
  })

  it("mock_response short-circuits the AI call and returns text into the data chain", async () => {
    const res = await aiGenerateOperation.execute(
      { role: "ai_search_chat", input: "ignored", mock_response: "canned reply" },
      { container: {}, dataChain: {} } as any
    )
    expect(res).toEqual({ success: true, data: { text: "canned reply" } })
  })

  it("mock_response of empty string is honored (not treated as absent)", async () => {
    const res = await aiGenerateOperation.execute(
      { role: "ai_search_chat", input: "x", mock_response: "" },
      { container: {}, dataChain: {} } as any
    )
    expect(res).toEqual({ success: true, data: { text: "" } })
  })
})
