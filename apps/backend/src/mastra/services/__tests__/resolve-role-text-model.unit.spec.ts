import {
  formatAiUsage,
  logAiUsage,
  resolveRoleTextModel,
  summarizeAiPlatformCatalog,
  groupAiCatalogByRole,
  sweepAiPlatformsByCategory,
  foldSystemContentMessages,
  type AiUsage,
} from "../ai-platforms"

describe("formatAiUsage", () => {
  const base: AiUsage = {
    feature: "store/ai/search",
    role: "ai_search_chat",
    provider: "dashscope",
    source: "platform",
    ok: true,
  }

  it("renders a full success line with optional fields", () => {
    const line = formatAiUsage({
      ...base,
      model: "qwen-plus",
      platformId: "01ABC",
      ms: 412.7,
      tokens: 1234,
    })
    expect(line).toBe(
      "[ai-usage] feature=store/ai/search role=ai_search_chat provider=dashscope source=platform model=qwen-plus platform=01ABC ok=true ms=413 tokens=1234"
    )
  })

  it("omits absent optionals and rounds ms", () => {
    const line = formatAiUsage({ ...base, ms: 9.9 })
    expect(line).toBe(
      "[ai-usage] feature=store/ai/search role=ai_search_chat provider=dashscope source=platform ok=true ms=10"
    )
    expect(line).not.toContain("model=")
    expect(line).not.toContain("tokens=")
  })

  it("renders a failure line with a truncated error and no tokens", () => {
    const line = formatAiUsage({
      ...base,
      ok: false,
      source: "free",
      provider: "openrouter",
      error: new Error("x".repeat(500)),
    })
    expect(line).toContain("ok=false")
    expect(line).toContain("source=free")
    expect(line).toMatch(/error=x{200}$/) // capped at 200 chars
  })

  it("accepts a plain-string error", () => {
    const line = formatAiUsage({ ...base, ok: false, error: "boom" })
    expect(line).toContain("error=boom")
  })
})

describe("logAiUsage", () => {
  it("routes success to info and failure to warn", () => {
    const calls: { level: string; msg: string }[] = []
    const logger = {
      info: (m: string) => calls.push({ level: "info", msg: m }),
      warn: (m: string) => calls.push({ level: "warn", msg: m }),
    }
    logAiUsage(logger, {
      feature: "f", role: "ai_search_chat", provider: "dashscope", source: "platform", ok: true,
    })
    logAiUsage(logger, {
      feature: "f", role: "ai_search_chat", provider: "openrouter", source: "free", ok: false, error: "e",
    })
    expect(calls.map((c) => c.level)).toEqual(["info", "warn"])
    expect(calls[0].msg).toContain("[ai-usage]")
  })

  it("never throws when the logger is missing methods", () => {
    expect(() =>
      logAiUsage({} as any, {
        feature: "f", role: "ai_search_chat", provider: "dashscope", source: "platform", ok: true,
      })
    ).not.toThrow()
  })
})

describe("summarizeAiPlatformCatalog", () => {
  it("maps rows, reading role/provider/model/default/key from metadata+api_config", () => {
    const rows = [
      {
        id: "01A",
        name: "Qwen prod",
        status: "active",
        metadata: { role: "ai_search_chat", provider_type: "dashscope", is_default: true },
        api_config: { default_model: "qwen-plus", api_key_encrypted: "xx" },
      },
      {
        id: "01B",
        status: "draft",
        metadata: { role: "ai_newsletter_drafter" },
        api_config: { provider_type: "openrouter", default_model: "x/y:free" },
      },
    ]
    const cat = summarizeAiPlatformCatalog(rows)
    expect(cat[0]).toEqual({
      platformId: "01A",
      name: "Qwen prod",
      role: "ai_search_chat",
      providerType: "dashscope",
      defaultModel: "qwen-plus",
      isDefault: true,
      status: "active",
      hasApiKey: true,
    })
    expect(cat[1].role).toBe("ai_newsletter_drafter")
    expect(cat[1].providerType).toBe("openrouter")
    expect(cat[1].isDefault).toBe(false)
    expect(cat[1].hasApiKey).toBe(false)
  })

  it("tolerates empty / missing fields", () => {
    expect(summarizeAiPlatformCatalog([])).toEqual([])
    const [e] = summarizeAiPlatformCatalog([{ id: "x" }])
    expect(e.role).toBeNull()
    expect(e.providerType).toBeNull()
    expect(e.hasApiKey).toBe(false)
  })

  it("auto-discovers an unknown/custom role verbatim (no allow-list)", () => {
    const [e] = summarizeAiPlatformCatalog([
      { id: "z", metadata: { role: "ai_my_custom_thing", provider_type: "custom" } },
    ])
    expect(e.role).toBe("ai_my_custom_thing")
  })
})

describe("groupAiCatalogByRole", () => {
  it("groups by role and buckets untagged platforms under _untagged", () => {
    const grouped = groupAiCatalogByRole(
      summarizeAiPlatformCatalog([
        { id: "1", metadata: { role: "ai_search_chat" } },
        { id: "2", metadata: { role: "ai_search_chat" } },
        { id: "3", metadata: {} },
      ])
    )
    expect(grouped["ai_search_chat"].map((e) => e.platformId)).toEqual(["1", "2"])
    expect(grouped["_untagged"].map((e) => e.platformId)).toEqual(["3"])
  })
})

describe("sweepAiPlatformsByCategory", () => {
  it("returns [] when the socials module can't be resolved", async () => {
    const container = { resolve: () => { throw new Error("no module") } } as any
    expect(await sweepAiPlatformsByCategory(container)).toEqual([])
  })

  it("queries category=ai and active-only by default, includeInactive widens it", async () => {
    const seen: any[] = []
    const container = {
      resolve: () => ({
        listSocialPlatforms: async (filters: any) => {
          seen.push(filters)
          return [{ id: "1", metadata: { role: "ai_search_chat" } }]
        },
      }),
    } as any
    const out = await sweepAiPlatformsByCategory(container)
    expect(seen[0]).toEqual({ category: "ai", status: "active" })
    expect(out[0].platformId).toBe("1")

    await sweepAiPlatformsByCategory(container, { includeInactive: true })
    expect(seen[1]).toEqual({ category: "ai" })
  })
})

describe("foldSystemContentMessages", () => {
  const msgs = [
    { role: "system", content: "SYS" },
    { role: "user", content: "hi" },
    { role: "assistant", content: "yo" },
    { role: "user", content: "again" },
  ]

  it("keeps system role untouched for OpenRouter", () => {
    const out = foldSystemContentMessages("openrouter", msgs)
    expect(out).toEqual(msgs)
    expect(out).not.toBe(msgs) // copied
  })

  it("folds system into the first user message for DashScope (no system role)", () => {
    const out = foldSystemContentMessages("dashscope", msgs)
    expect(out.find((m) => m.role === "system")).toBeUndefined()
    expect(out[0]).toEqual({ role: "user", content: "SYS\n\nhi" })
    expect(out[2]).toEqual({ role: "user", content: "again" }) // later user untouched
  })

  it("joins multiple system messages", () => {
    const out = foldSystemContentMessages("cloudflare", [
      { role: "system", content: "A" },
      { role: "system", content: "B" },
      { role: "user", content: "q" },
    ])
    expect(out).toEqual([{ role: "user", content: "A\n\nB\n\nq" }])
  })

  it("prepends a user message when none exists", () => {
    const out = foldSystemContentMessages("dashscope", [
      { role: "system", content: "SYS" },
      { role: "assistant", content: "hello" },
    ])
    expect(out[0]).toEqual({ role: "user", content: "SYS" })
    expect(out[1].role).toBe("assistant")
  })

  it("is a no-op (minus system) when there's no system text", () => {
    const out = foldSystemContentMessages("dashscope", [{ role: "user", content: "q" }])
    expect(out).toEqual([{ role: "user", content: "q" }])
  })
})

describe("resolveRoleTextModel", () => {
  it("falls back to the free rotator when the container can't resolve a platform", async () => {
    // container.resolve throws → getAiPlatformForRole returns null → free fallback
    const container = {
      resolve: () => {
        throw new Error("no socials module")
      },
    } as any
    const out = await resolveRoleTextModel(container, "ai_search_chat")
    expect(out.source).toBe("free")
    expect(out.provider ?? out.providerType).toBeDefined()
    expect(out.providerType).toBe("openrouter")
    expect(out.modelId).toBe("free-rotator")
    expect(out.model).toBeDefined()
    expect(out.platformId).toBeUndefined()
  })
})
