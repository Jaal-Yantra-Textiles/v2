import { rewriteDeveloperRole, isOpenAiHost } from "../ai-platforms"

/**
 * `@ai-sdk/openai` renames the `system` role to `developer` for anything it
 * decides is a "reasoning model", and it decides that by NAME:
 *
 *   isReasoningModel = !(modelId.startsWith("gpt-3") || startsWith("gpt-4")
 *                        || startsWith("chatgpt-4o") || startsWith("gpt-5-chat"))
 *
 * Every model id on this platform fails that test. Most OpenAI-compatible
 * endpoints shrug at the unknown role; Groq's chat template raises:
 *
 *   minijinja: rendering failed: raise_exception: Unexpected message role.
 *
 * 🔑 This was invisible from the outside. Hand-built requests to the same key
 * and model succeeded in plain, `json_schema` AND tool modes — because they all
 * said `system`. It only reproduced by running the real `generateObject` behind
 * a fetch interceptor, which printed `ROLES: developer -> user`.
 */
describe("rewriteDeveloperRole", () => {
  const body = (roles: string[]) =>
    JSON.stringify({
      model: "qwen/qwen3.8-27b",
      messages: roles.map((role) => ({ role, content: "x" })),
    })

  it("renames developer to system", () => {
    const out = JSON.parse(rewriteDeveloperRole(body(["developer", "user"])))
    expect(out.messages.map((m: any) => m.role)).toEqual(["system", "user"])
  })

  it("leaves every other role alone", () => {
    const out = JSON.parse(
      rewriteDeveloperRole(body(["system", "user", "assistant", "tool"]))
    )
    expect(out.messages.map((m: any) => m.role)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
    ])
  })

  it("returns the body UNCHANGED when there is nothing to rewrite", () => {
    // Identity matters: re-serialising every request would reorder keys and
    // churn bodies for no reason.
    const original = body(["system", "user"])
    expect(rewriteDeveloperRole(original)).toBe(original)
  })

  it("passes through a body it cannot parse", () => {
    // This is a compatibility shim, not a gate — it must never be the thing
    // that fails a request.
    expect(rewriteDeveloperRole("not json")).toBe("not json")
    expect(rewriteDeveloperRole("")).toBe("")
  })

  it("passes through a body with no messages array", () => {
    const b = JSON.stringify({ model: "x", input: "y" })
    expect(rewriteDeveloperRole(b)).toBe(b)
  })

  it("survives a malformed message entry", () => {
    const b = JSON.stringify({ messages: [null, { role: "developer" }, 42] })
    const out = JSON.parse(rewriteDeveloperRole(b))
    expect(out.messages[1].role).toBe("system")
  })
})

describe("isOpenAiHost", () => {
  /**
   * ⚠️ The rewrite must NOT reach genuine OpenAI: its real reasoning models
   * require `developer` and reject `system`, so applying the shim there would
   * break the one provider the SDK's behaviour is correct for.
   */
  it("recognises OpenAI itself", () => {
    expect(isOpenAiHost("https://api.openai.com/v1")).toBe(true)
  })

  it.each([
    ["groq", "https://api.groq.com/openai/v1"],
    ["bazaarlink", "https://bazaarlink.ai/api/v1"],
    ["dashscope", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"],
    ["nvidia nim", "https://integrate.api.nvidia.com/v1"],
  ])("treats %s as compatible-but-not-OpenAI", (_label, url) => {
    expect(isOpenAiHost(url)).toBe(false)
  })

  it("is not fooled by a lookalike host", () => {
    // `api.openai.com.evil.test` must not match, and a path mentioning openai
    // (as Groq's does) must not either.
    expect(isOpenAiHost("https://api.openai.com.evil.test/v1")).toBe(false)
    expect(isOpenAiHost("https://api.groq.com/openai/v1")).toBe(false)
  })

  it("handles a missing or unparseable base url", () => {
    expect(isOpenAiHost(undefined)).toBe(false)
    expect(isOpenAiHost(null)).toBe(false)
    expect(isOpenAiHost("")).toBe(false)
    expect(isOpenAiHost("not a url")).toBe(false)
  })
})
