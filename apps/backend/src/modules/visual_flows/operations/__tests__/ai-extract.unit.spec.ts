jest.mock("ai", () => ({
  generateText: jest.fn(async () => ({ text: '{"order_number":"JH27228"}' })),
}))
jest.mock("../../../../mastra/workflows/extractionEval", () => ({ extractionEvalWorkflow: {} }))
jest.mock("../../../../mastra/services/ai-platforms", () => ({
  resolveRoleTextModel: jest.fn(async () => ({
    model: {},
    providerType: "openai_compatible",
    source: "platform",
    modelId: "platform-model",
  })),
  buildGenerateArgs: jest.fn(() => ({ prompt: "x" })),
  logAiUsage: jest.fn(),
}))

import { resolveRoleTextModel } from "../../../../mastra/services/ai-platforms"
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

  it("never forwards a flow's saved legacy model to the platform (2026-10-08)", async () => {
    // A flow saved with an OpenRouter id sent it to whatever provider the role
    // used later → model_not_found. The platform's own model must win.
    const res = await aiExtractOperation.execute(
      { role: "ai_search_chat", input: "x", model: "arcee-ai/trinity-large-preview:free" },
      { container: {}, dataChain: {} } as any
    )
    expect(res).toEqual({ success: true, data: { order_number: "JH27228" } })
    expect(resolveRoleTextModel).toHaveBeenCalledWith({}, "ai_search_chat")
    expect((resolveRoleTextModel as jest.Mock).mock.calls[0]).toHaveLength(2)
  })
})
