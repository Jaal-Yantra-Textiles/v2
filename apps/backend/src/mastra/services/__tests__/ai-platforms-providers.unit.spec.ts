import {
  PROVIDER_TYPES,
  type AiProviderType,
} from "../ai-platforms"

/**
 * Provider registration, and the two model choices that were MEASURED rather
 * than guessed.
 *
 * The reason this file exists: `groq` was a fully supported provider in the
 * resolver for months, with a default base URL and a vision-capable model
 * hint — and prod had **zero** Groq rows. It could not be created, because the
 * admin form's provider enum never listed it. Nothing failed; the option
 * simply was not there. These assertions are the cheap guard against a
 * provider being half-registered again.
 */
describe("AI provider registration", () => {
  it.each(["groq", "bazaarlink"] as AiProviderType[])(
    "%s is in PROVIDER_TYPES, so coverage reporting can see it",
    (p) => {
      expect(PROVIDER_TYPES).toContain(p)
    }
  )

  it("keeps custom last — it is the catch-all, not a preference", () => {
    expect(PROVIDER_TYPES[PROVIDER_TYPES.length - 1]).toBe("custom")
  })

  /**
   * 🔴 The admin form is the ONLY way an operator creates a platform row, and
   * its provider enum is a separate literal from `PROVIDER_TYPES`. That
   * duplication is exactly how Groq ended up supported-but-uncreatable.
   *
   * Read as text rather than imported: the component is a `.tsx` admin file
   * outside this tsconfig's program, and the point is to catch the two lists
   * drifting apart, which a string check does honestly.
   */
  it("exposes every resolver provider in the admin create form", () => {
    const fs = require("fs") as typeof import("fs")
    const path = require("path") as typeof import("path")
    const file = path.join(
      __dirname,
      "../../../admin/components/social-platforms/create-ai-platform-component.tsx"
    )
    const src = fs.readFileSync(file, "utf8")

    const enumBlock = src.slice(
      src.indexOf("const ProviderTypeEnum"),
      src.indexOf("const Schema")
    )

    for (const p of PROVIDER_TYPES) {
      expect({ provider: p, listedInAdminForm: enumBlock.includes(`"${p}"`) })
        .toEqual({ provider: p, listedInAdminForm: true })
    }
  })
})

/**
 * Both hints below were measured against the SAME document photo, through the
 * real APIs, not chosen from a model card.
 */
describe("vision model hints", () => {
  const defaults = require("../ai-platforms")

  it("does not default Groq to a model that thinks instead of answering", () => {
    /**
     * `qwen/qwen3.6-27b` — the hint this repo shipped — is a reasoning model.
     * On an ID-card image it emitted `<think>` and had still not produced the
     * answer when a 4000-token budget ran out. That is indistinguishable from
     * "the provider returned nothing", which is the failure #1813 spent a
     * session chasing and which `isBlindRead` now rejects at some cost.
     *
     * `qwen/qwen3.8-27b`, same prompt and image, answered correctly.
     */
    const hint = defaults.PROVIDER_DEFAULTS?.groq?.defaultModelHint
    expect(hint).not.toContain("qwen3.6")
  })

  it("points BazaarLink at a vision-capable model", () => {
    const hint = defaults.PROVIDER_DEFAULTS?.bazaarlink?.defaultModelHint
    // Of 169 models on the catalogue, exactly one is both free and accepts
    // images; it transcribed the test card correctly in 5.5s.
    expect(hint).toBe("qwen/qwen3.7-flash:free")
  })

  it("gives BazaarLink a base URL, so a row needs only a key", () => {
    expect(defaults.PROVIDER_DEFAULTS?.bazaarlink?.baseUrl).toBe(
      "https://bazaarlink.ai/api/v1"
    )
  })
})
