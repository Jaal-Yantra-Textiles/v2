import { CAPABILITY_ACTIONS } from "../actions"
import { getTechnique, normalizeTechnique, sampleTechniqueSlug, TECHNIQUES } from "../techniques"

describe("normalizeTechnique (#2596)", () => {
  it.each([
    ["block_print", "block_print"],
    ["Block Print", "block_print"],
    ["hand block printing", "block_print"],
    ["AARI work on wool", "hand_embroidery"],
    ["Handloom", "handloom_weaving"],
    ["hand-painted", "hand_painting"],
    ["Shibori", "tie_dye"],
    ["machine embroidery", "machine_embroidery"],
    // Words seen on prod by the 2026-11-24 backfill.
    ["block printed", "block_print"],
    ["tangaliya", "handloom_weaving"],
    ["Jamdani", "handloom_weaving"],
    ["ikat", "handloom_weaving"],
    ["kani", "handloom_weaving"],
    ["hand screen printing", "screen_print"],
  ])("%s → %s", (input, slug) => {
    expect(normalizeTechnique(input)).toBe(slug)
  })

  it.each([null, undefined, "", "   ", "blueprint drafting", "embroidered", "wrinkled / crinkle texture"])(
    "%p maps to nothing rather than a guess",
    (input) => {
      expect(normalizeTechnique(input)).toBeNull()
    }
  )

  it("prefers the longer, more specific name", () => {
    // "embroidery" (hand) is inside "machine embroidery"; the longer wins.
    expect(normalizeTechnique("computer embroidery logo")).toBe("machine_embroidery")
  })
})

describe("technique vocabulary", () => {
  it("has unique slugs and every alternative is a real slug", () => {
    const slugs = TECHNIQUES.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const t of TECHNIQUES) {
      for (const alt of t.alternatives) expect(getTechnique(alt)).not.toBeNull()
      expect(t.alternatives).not.toContain(t.slug)
    }
  })

  it("every technique sits under a known action", () => {
    for (const t of TECHNIQUES) expect(CAPABILITY_ACTIONS).toContain(t.action)
  })

  it("no alias belongs to two techniques", () => {
    const seen = new Map<string, string>()
    for (const t of TECHNIQUES) {
      for (const a of t.aliases) {
        expect([a, seen.get(a) ?? t.slug]).toEqual([a, t.slug])
        seen.set(a, t.slug)
      }
    }
  })
})

describe("sampleTechniqueSlug (#2606)", () => {

  it("drops a weave technique on a stitch-only sample (Prince Tailors' tangaliya skirt)", () => {
    expect(sampleTechniqueSlug("tangaliya", ["stitch"])).toBeNull()
  })

  it("keeps the technique when the partner did that work", () => {
    expect(sampleTechniqueSlug("tangaliya", ["weave"])).toBe("handloom_weaving")
    expect(sampleTechniqueSlug("hand block print", ["print", "stitch"])).toBe("block_print")
  })

  it("keeps the technique when no actions are recorded", () => {
    expect(sampleTechniqueSlug("handloom", [])).toBe("handloom_weaving")
    expect(sampleTechniqueSlug("handloom", null)).toBe("handloom_weaving")
  })

  it("is null for a technique outside the vocabulary", () => {
    expect(sampleTechniqueSlug("embroidered", ["stitch"])).toBeNull()
  })
})
