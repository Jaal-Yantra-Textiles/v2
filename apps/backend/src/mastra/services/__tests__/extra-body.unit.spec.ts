import { generateText } from "ai"

import { buildChatModel, mergeExtraBody } from "../ai-platforms"

/**
 * `api_config.extra_body` — provider-specific request fields on a platform row.
 * First use: `{ thinking: { type: "disabled" } }` on the Z.ai GLM rows serving
 * the admin/partner assistants, which took 14–54 s per call with thinking on
 * (measured on prod 2026-11-17).
 */
describe("mergeExtraBody", () => {
  const body = JSON.stringify({ model: "glm-4.7-flash", messages: [{ role: "user", content: "hi" }] })

  it("adds the extra fields", () => {
    const out = JSON.parse(mergeExtraBody(body, { thinking: { type: "disabled" } }))
    expect(out.thinking).toEqual({ type: "disabled" })
    expect(out.messages).toEqual([{ role: "user", content: "hi" }])
  })

  it("🔴 never replaces a field the request already carries", () => {
    const out = JSON.parse(
      mergeExtraBody(body, { model: "something-else", messages: [], thinking: { type: "disabled" } })
    )
    expect(out.model).toBe("glm-4.7-flash")
    expect(out.messages).toEqual([{ role: "user", content: "hi" }])
    expect(out.thinking).toEqual({ type: "disabled" })
  })

  it("passes the body through untouched with no extras or an unparseable body", () => {
    expect(mergeExtraBody(body, undefined)).toBe(body)
    expect(mergeExtraBody(body, {})).toBe(body)
    expect(mergeExtraBody("not json", { thinking: 1 })).toBe("not json")
  })
})

describe("buildChatModel sends extra_body on the wire", () => {
  const sent: any[] = []
  let fetchSpy: jest.SpyInstance

  beforeEach(() => {
    sent.length = 0
    fetchSpy = jest.spyOn(global, "fetch").mockImplementation(async (_url: any, init?: any) => {
      sent.push(JSON.parse(init.body))
      return new Response(
        JSON.stringify({
          id: "x",
          object: "chat.completion",
          created: 0,
          model: "glm-4.7-flash",
          choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    })
  })

  afterEach(() => fetchSpy.mockRestore())

  const config = {
    platformId: "p1",
    providerType: "custom" as const,
    apiKey: "k",
    baseUrl: "https://api.z.ai/api/paas/v4",
    defaultModel: "glm-4.7-flash",
  }

  it("adds the row's extra_body to the request, alongside the system-role rewrite", async () => {
    const model = buildChatModel({ ...config, extraBody: { thinking: { type: "disabled" } } })
    await generateText({ model, system: "be brief", prompt: "hi" })

    expect(sent).toHaveLength(1)
    expect(sent[0].thinking).toEqual({ type: "disabled" })
    expect(sent[0].messages.map((m: any) => m.role)).not.toContain("developer")
  })

  it("sends nothing extra for a row without extra_body", async () => {
    const model = buildChatModel(config)
    await generateText({ model, prompt: "hi" })
    expect(sent[0].thinking).toBeUndefined()
  })
})
