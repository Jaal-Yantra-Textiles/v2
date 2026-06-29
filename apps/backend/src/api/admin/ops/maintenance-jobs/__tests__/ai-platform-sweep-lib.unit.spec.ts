import {
  buildAiPlatformCoverageReport,
  planAiPlatformNormalization,
} from "../ai-platform-sweep-lib"
import type { AiPlatformCatalogEntry } from "../../../../../mastra/services/ai-platforms"

const KNOWN = [
  "ai_search_chat",
  "ai_search_embed",
  "ai_product_description",
  "ai_image_gen",
  "ai_digest_summary",
  "ai_newsletter_drafter",
] as const

const entry = (
  over: Partial<AiPlatformCatalogEntry> & { platformId: string }
): AiPlatformCatalogEntry => ({
  name: over.platformId,
  role: null,
  providerType: null,
  defaultModel: null,
  isDefault: false,
  status: "active",
  hasApiKey: true,
  ...over,
})

describe("buildAiPlatformCoverageReport", () => {
  it("reports every known role even with an empty catalog (all free-fallback)", () => {
    const report = buildAiPlatformCoverageReport([], KNOWN)
    expect(report.roles.map((r) => r.role)).toEqual([...KNOWN])
    expect(report.totals).toEqual({
      knownRoles: 6,
      configuredRoles: 0,
      freeFallbackRoles: 6,
      untaggedPlatforms: 0,
    })
    expect(report.roles.every((r) => r.flags.includes("no-platform→free-fallback"))).toBe(true)
    expect(report.summary).toContain("0/6 known AI roles configured")
  })

  it("counts a configured (active+keyed+default) role and omits free-fallback flag", () => {
    const catalog = [
      entry({ platformId: "p1", role: "ai_search_chat", isDefault: true }),
    ]
    const report = buildAiPlatformCoverageReport(catalog, KNOWN)
    const chat = report.roles.find((r) => r.role === "ai_search_chat")!
    expect(chat.configured).toBe(true)
    expect(chat.hasDefault).toBe(true)
    expect(chat.flags).toEqual([])
    expect(report.totals.configuredRoles).toBe(1)
    expect(report.totals.freeFallbackRoles).toBe(5)
  })

  it("flags missing-api-key and no-default", () => {
    const catalog = [
      entry({ platformId: "p1", role: "ai_search_chat", hasApiKey: false }),
    ]
    const report = buildAiPlatformCoverageReport(catalog, KNOWN)
    const chat = report.roles.find((r) => r.role === "ai_search_chat")!
    expect(chat.configured).toBe(false) // no usable platform
    expect(chat.flags).toEqual(
      expect.arrayContaining(["no-usable-platform", "missing-api-key", "no-default"])
    )
  })

  it("flags ambiguous-default when >1 usable platform and none default", () => {
    const catalog = [
      entry({ platformId: "p1", role: "ai_search_chat" }),
      entry({ platformId: "p2", role: "ai_search_chat" }),
    ]
    const report = buildAiPlatformCoverageReport(catalog, KNOWN)
    const chat = report.roles.find((r) => r.role === "ai_search_chat")!
    expect(chat.configured).toBe(true)
    expect(chat.flags).toEqual(expect.arrayContaining(["no-default", "ambiguous-default"]))
  })

  it("buckets untagged platforms and surfaces unknown custom roles", () => {
    const catalog = [
      entry({ platformId: "p1" }), // no role → _untagged
      entry({ platformId: "p2", role: "ai_marketing_vp", isDefault: true }), // custom
    ]
    const report = buildAiPlatformCoverageReport(catalog, KNOWN)
    const untagged = report.roles.find((r) => r.role === "_untagged")!
    expect(untagged.flags).toContain("untagged-role")
    expect(untagged.configured).toBe(false)
    const custom = report.roles.find((r) => r.role === "ai_marketing_vp")!
    expect(custom.known).toBe(false)
    expect(custom.flags).toContain("unknown-role")
    expect(report.totals.untaggedPlatforms).toBe(1)
    expect(report.summary).toContain("1 platform(s) have no role tag")
  })

  it("never leaks secrets — only hasApiKey boolean is surfaced", () => {
    const catalog = [
      entry({ platformId: "p1", role: "ai_search_chat", hasApiKey: true }),
    ]
    const report = buildAiPlatformCoverageReport(catalog, KNOWN)
    const platform = report.roles.find((r) => r.role === "ai_search_chat")!.platforms[0]
    expect(Object.keys(platform)).toEqual(
      expect.not.arrayContaining(["api_key", "apiKey", "api_key_encrypted"])
    )
    expect(platform.hasApiKey).toBe(true)
  })
})

describe("planAiPlatformNormalization", () => {
  it("marks the sole usable platform of a role as default", () => {
    const catalog = [entry({ platformId: "p1", role: "ai_search_chat" })]
    const plan = planAiPlatformNormalization(catalog)
    expect(plan).toEqual([
      {
        platformId: "p1",
        role: "ai_search_chat",
        field: "metadata.is_default",
        before: false,
        after: true,
        reason: "sole usable platform for role — marking default",
      },
    ])
  })

  it("is idempotent — no action once a default exists", () => {
    const catalog = [
      entry({ platformId: "p1", role: "ai_search_chat", isDefault: true }),
    ]
    expect(planAiPlatformNormalization(catalog)).toEqual([])
  })

  it("does not touch ambiguous roles (>1 usable platform)", () => {
    const catalog = [
      entry({ platformId: "p1", role: "ai_search_chat" }),
      entry({ platformId: "p2", role: "ai_search_chat" }),
    ]
    expect(planAiPlatformNormalization(catalog)).toEqual([])
  })

  it("ignores unusable (inactive / unkeyed) sole platforms", () => {
    const catalog = [
      entry({ platformId: "p1", role: "ai_search_chat", status: "inactive" }),
    ]
    expect(planAiPlatformNormalization(catalog)).toEqual([])
  })

  it("skips the _untagged bucket", () => {
    const catalog = [entry({ platformId: "p1" })]
    expect(planAiPlatformNormalization(catalog)).toEqual([])
  })
})
