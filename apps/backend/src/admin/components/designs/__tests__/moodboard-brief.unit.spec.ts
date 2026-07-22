import { buildMoodboardBlock } from "../../../../workflows/designs/moodboard/build-moodboard-scene"
import { extractBriefEdits } from "../moodboard-brief"

/**
 * #1113 — round-trip: the Concept & Identity block the server builds must be
 * parseable back into brief edits by the editors' shared parser, so on-canvas
 * edits persist to concept_theme + aesthetic_keywords.
 */
describe("moodboard brief round-trip parser", () => {
  const buildConcept = (brief: Record<string, any>) =>
    buildMoodboardBlock({ brief, seed: 1 } as any, "brief-concept")!

  it("parses concept_theme + aesthetic_keywords from a filled concept block", () => {
    const block = buildConcept({
      concept_theme: "Coastal minimalism",
      aesthetic_keywords: ["airy", "muted", "linen"],
    })
    expect(extractBriefEdits(block.elements)).toEqual({
      concept_theme: "Coastal minimalism",
      aesthetic_keywords: ["airy", "muted", "linen"],
    })
  })

  it("returns null for an empty concept template (placeholder only)", () => {
    const block = buildConcept({})
    // The template still renders (insertable when empty) but carries no real
    // values, so nothing is written back.
    expect(extractBriefEdits(block.elements)).toBeNull()
  })

  it("parses keywords a designer typed onto the editable line", () => {
    const block = buildConcept({})
    const els = block.elements.map((el: any) =>
      el.customData?.field === "aesthetic_keywords"
        ? { ...el, text: "Aesthetic keywords: bold, saturated,  ,neon" }
        : el
    )
    const edits = extractBriefEdits(els)
    expect(edits?.aesthetic_keywords).toEqual(["bold", "saturated", "neon"])
    expect(edits?.concept_theme).toBeUndefined()
  })
})
