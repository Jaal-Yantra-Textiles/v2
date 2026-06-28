import {
  foldSystemForProvider,
  type ChatUiMessage,
} from "../system-fold-lib"

const msg = (role: string, text: string): ChatUiMessage => ({
  role,
  parts: [{ type: "text", text }],
})

describe("foldSystemForProvider", () => {
  const SYSTEM = "You are a concierge."

  it("keeps the native system param for OpenRouter (env fallback id)", () => {
    const messages = [msg("user", "hi")]
    const out = foldSystemForProvider("openrouter:free", SYSTEM, messages)
    expect(out.system).toBe(SYSTEM)
    expect(out.messages).toEqual(messages)
  })

  it("keeps the native system param for a DB-configured OpenRouter platform", () => {
    const out = foldSystemForProvider("db:openrouter:01ABC", SYSTEM, [msg("user", "hi")])
    expect(out.system).toBe(SYSTEM)
  })

  it("folds system into the first user message for DashScope (no system role)", () => {
    const out = foldSystemForProvider("db:dashscope:01XYZ", SYSTEM, [msg("user", "hi there")])
    expect(out.system).toBeUndefined()
    expect(out.messages[0].role).toBe("user")
    expect(out.messages[0].parts[0].text).toBe(`${SYSTEM}\n\nhi there`)
  })

  it("folds for Cloudflare too (any non-openrouter provider)", () => {
    const out = foldSystemForProvider("cloudflare:@cf/meta/llama-3.1-8b-instruct", SYSTEM, [
      msg("user", "hi"),
    ])
    expect(out.system).toBeUndefined()
    expect(out.messages[0].parts[0].text).toBe(`${SYSTEM}\n\nhi`)
  })

  it("folds into the FIRST user message when history has assistant turns", () => {
    const messages = [
      msg("user", "first"),
      msg("assistant", "reply"),
      msg("user", "second"),
    ]
    const out = foldSystemForProvider("dashscope:qwen-plus", SYSTEM, messages)
    expect(out.messages[0].parts[0].text).toBe(`${SYSTEM}\n\nfirst`)
    // later turns untouched
    expect(out.messages[1].parts[0].text).toBe("reply")
    expect(out.messages[2].parts[0].text).toBe("second")
  })

  it("prepends a user message when there's no user turn", () => {
    const out = foldSystemForProvider("dashscope:qwen-plus", SYSTEM, [msg("assistant", "hello")])
    expect(out.messages[0].role).toBe("user")
    expect(out.messages[0].parts[0].text).toBe(SYSTEM)
    expect(out.messages[1].role).toBe("assistant")
  })

  it("inserts a text part when the first user message has none", () => {
    const out = foldSystemForProvider("dashscope:qwen-plus", SYSTEM, [
      { role: "user", parts: [] },
    ])
    expect(out.messages[0].parts[0]).toEqual({ type: "text", text: SYSTEM })
  })

  it("does not pass an empty system param when system is blank", () => {
    const out = foldSystemForProvider("dashscope:qwen-plus", "   ", [msg("user", "hi")])
    expect(out.system).toBeUndefined()
    expect(out.messages[0].parts[0].text).toBe("hi")
  })

  it("does not mutate the caller's messages array or parts", () => {
    const messages = [msg("user", "hi")]
    const snapshot = JSON.stringify(messages)
    foldSystemForProvider("dashscope:qwen-plus", SYSTEM, messages)
    expect(JSON.stringify(messages)).toBe(snapshot)
  })
})
