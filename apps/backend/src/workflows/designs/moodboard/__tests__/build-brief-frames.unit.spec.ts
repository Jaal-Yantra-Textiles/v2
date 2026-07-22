/**
 * Unit test — brief anchor frames (#1113 S2).
 *
 * Pure scene-builder tests for the design-brief cards: the three brief frames
 * (Concept & Identity · Audience & Positioning · Timeline & Budget), section
 * predicates, determinism, and the brief-only path (no tech-pack data).
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="build-brief-frames"
 */
import {
  buildMoodboardScene,
  briefHasContent,
  hasConceptSection,
  hasAudienceSection,
  hasTimelineSection,
  type TechPackBrief,
  type TechPackSceneInput,
} from "../build-moodboard-scene"

const FULL_BRIEF: TechPackBrief = {
  concept_theme: "90s Tokyo Streetwear",
  aesthetic_keywords: ["utilitarian", "sleek", "nostalgic"],
  persona: {
    age_range: "25-34",
    lifestyle: "urban minimalist",
    values: ["sustainability"],
    pain_points: ["fast-fashion fatigue"],
  },
  competitors: [{ name: "Acme Knits", differentiator: "hand-loomed" }],
  price_point: "mid_market",
  milestones: [
    { label: "Initial sketches", date: "2026-08-01" },
    { label: "Production-ready samples", date: null },
  ],
  design_budget: 250000,
  cost_currency: "inr",
  target_completion_date: "2026-10-15",
}

const baseInput = (brief?: TechPackBrief): TechPackSceneInput => ({
  design: { title: "Brief Test" },
  garment_type: "top",
  flats: {},
  ...(brief ? { brief } : {}),
})

describe("brief section predicates", () => {
  it("detects each section independently", () => {
    expect(hasConceptSection({ concept_theme: "x" })).toBe(true)
    expect(hasConceptSection({ aesthetic_keywords: ["a"] })).toBe(true)
    expect(hasAudienceSection({ price_point: "luxury" })).toBe(true)
    expect(hasTimelineSection({ design_budget: 100 })).toBe(true)
    expect(hasTimelineSection({ milestones: [{ label: "m" }] })).toBe(true)
    expect(briefHasContent({})).toBe(false)
    expect(briefHasContent(undefined)).toBe(false)
  })
})

describe("buildMoodboardScene with a brief", () => {
  const scene = buildMoodboardScene(baseInput(FULL_BRIEF))
  const frameNames = scene.elements.filter((e) => e.type === "frame").map((f) => f.name)

  it("renders the three brief frames first, before the header frame", () => {
    expect(frameNames.slice(0, 3)).toEqual([
      "Brief · Concept & Identity",
      "Brief · Audience & Positioning",
      "Brief · Timeline & Budget",
    ])
    expect(frameNames).toContain("1 · Header & Flats")
  })

  it("renders the concept theme + aesthetic keyword pills", () => {
    const texts = scene.elements.filter((e) => e.type === "text").map((e) => e.text)
    expect(texts).toContain("90s Tokyo Streetwear")
    // Each keyword is its own pill label.
    expect(texts).toContain("utilitarian")
    expect(texts).toContain("sleek")
    expect(texts).toContain("nostalgic")
  })

  it("renders persona, competitors and price point", () => {
    const blob = scene.elements
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join("\n")
    expect(blob).toContain("urban minimalist")
    expect(blob).toContain("Acme Knits")
    expect(blob).toContain("Mid-market")
  })

  it("renders milestones and the design budget with currency", () => {
    const blob = scene.elements
      .filter((e) => e.type === "text")
      .map((e) => e.text)
      .join("\n")
    expect(blob).toContain("Initial sketches")
    expect(blob).toContain("Production-ready samples")
    expect(blob).toContain("INR 250,000")
    expect(blob).toContain("2026-10-15")
  })

  it("stamps value cards with brief-field customData for round-trip editing", () => {
    const fields = scene.elements
      .filter((e) => (e.customData as any)?.kind === "brief-field")
      .map((e) => (e.customData as any).field)
    expect(fields).toEqual(
      expect.arrayContaining([
        "concept_theme",
        "aesthetic_keywords",
        "persona",
        "competitors",
        "price_point",
        "milestones",
        "design_budget",
        "target_completion_date",
      ])
    )
  })

  it("is deterministic (byte-stable across builds)", () => {
    expect(JSON.stringify(buildMoodboardScene(baseInput(FULL_BRIEF)))).toEqual(
      JSON.stringify(scene)
    )
  })
})

describe("partial + empty briefs", () => {
  it("emits only the sections that have content", () => {
    const scene = buildMoodboardScene(baseInput({ concept_theme: "Just a concept" }))
    const names = scene.elements.filter((e) => e.type === "frame").map((f) => f.name)
    expect(names).toContain("Brief · Concept & Identity")
    expect(names).not.toContain("Brief · Audience & Positioning")
    expect(names).not.toContain("Brief · Timeline & Budget")
  })

  it("adds no brief frames when there is no brief", () => {
    const names = buildMoodboardScene(baseInput())
      .elements.filter((e) => e.type === "frame")
      .map((f) => f.name)
    expect(names.some((n) => String(n).startsWith("Brief ·"))).toBe(false)
  })
})
