import { aiExtractOperation } from "../ai-extract"

describe("aiExtractOperation (platform migration)", () => {
  it("defaults role to ai_search_chat and no longer hardcodes a model", () => {
    expect(aiExtractOperation.type).toBe("ai_extract")
    expect((aiExtractOperation.defaultOptions as any).role).toBe("ai_search_chat")
    // legacy `model` default removed (now an optional deprecated override)
    expect((aiExtractOperation.defaultOptions as any).model).toBeUndefined()
  })

  it("optionsSchema applies role default and keeps model optional", () => {
    const parsed = aiExtractOperation.optionsSchema!.parse({ input: "some text" }) as any
    expect(parsed.role).toBe("ai_search_chat")
    expect(parsed.model).toBeUndefined()
    expect(parsed.fallback_on_error).toBe(false)
  })

  it("mock_response short-circuits the AI call (backward-compatible)", async () => {
    const res = await aiExtractOperation.execute(
      { role: "ai_search_chat", input: "x", mock_response: { title: "Tee", price: 1200 } },
      { container: {}, dataChain: {} } as any
    )
    expect(res).toEqual({ success: true, data: { title: "Tee", price: 1200 } })
  })
})
