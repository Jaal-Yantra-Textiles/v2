/**
 * Unit test — insert-block palette (#1113 S3+).
 *
 * The drop-in blocks: listMoodboardBlocks (availability) + buildMoodboardBlock
 * (one frame at origin, preserving customData; unknown key → null).
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="build-moodboard-block"
 */
import {
  buildMoodboardBlock,
  listMoodboardBlocks,
  MOODBOARD_BLOCKS,
  type TechPackBrief,
  type TechPackSceneInput,
} from "../build-moodboard-scene"

const FULL_BRIEF: TechPackBrief = {
  concept_theme: "90s Tokyo Streetwear",
  aesthetic_keywords: ["utilitarian", "sleek"],
  price_point: "mid_market",
  design_budget: 250000,
  cost_currency: "inr",
}

const baseInput = (brief?: TechPackBrief): TechPackSceneInput => ({
  design: { title: "Block Test" },
  garment_type: "top",
  flats: {},
  ...(brief ? { brief } : {}),
})

describe("listMoodboardBlocks", () => {
  it("lists every block; scaffolds always available, data blocks gated", () => {
    const listing = listMoodboardBlocks(baseInput(FULL_BRIEF))
    expect(listing).toHaveLength(MOODBOARD_BLOCKS.length)

    const byKey = Object.fromEntries(listing.map((b) => [b.key, b]))
    // Brief sections present in FULL_BRIEF → available.
    expect(byKey["brief-concept"].available).toBe(true)
    expect(byKey["brief-timeline"].available).toBe(true)
    // Scaffolds are always insertable.
    expect(byKey["header-flats"].available).toBe(true)
    expect(byKey["workspace"].available).toBe(true)
    // No specs/materials/construction data → not available.
    expect(byKey["design-specs"].available).toBe(false)
    expect(byKey["construction"].available).toBe(false)
    expect(byKey["materials"].available).toBe(false)
  })

  it("gates brief blocks off when the brief is empty", () => {
    const byKey = Object.fromEntries(
      listMoodboardBlocks(baseInput()).map((b) => [b.key, b])
    )
    expect(byKey["brief-concept"].available).toBe(false)
    expect(byKey["brief-audience"].available).toBe(false)
    // Scaffold still available with no data at all.
    expect(byKey["workspace"].available).toBe(true)
  })
})

describe("buildMoodboardBlock", () => {
  it("builds exactly one frame at origin (x=0), preserving brief-field customData", () => {
    const scene = buildMoodboardBlock(baseInput(FULL_BRIEF), "brief-concept")
    expect(scene).not.toBeNull()

    const frames = scene!.elements.filter((e) => e.type === "frame")
    expect(frames).toHaveLength(1)
    expect(frames[0].name).toBe("Brief · Concept & Identity")
    expect(frames[0].x).toBe(0)

    // The concept card round-trip contract survives on the drop-in block.
    const conceptRect = scene!.elements.find(
      (e) =>
        e.type === "rectangle" &&
        (e.customData as any)?.kind === "brief-field" &&
        (e.customData as any)?.field === "concept_theme"
    )
    expect(conceptRect).toBeTruthy()

    // Every child element belongs to the single frame.
    const frameId = frames[0].id
    const children = scene!.elements.filter((e) => e.type !== "frame")
    expect(children.every((e) => e.frameId === frameId)).toBe(true)
  })

  it("is deterministic for the same input", () => {
    const a = buildMoodboardBlock(baseInput(FULL_BRIEF), "brief-concept")
    const b = buildMoodboardBlock(baseInput(FULL_BRIEF), "brief-concept")
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it("returns null for an unknown block key", () => {
    expect(buildMoodboardBlock(baseInput(FULL_BRIEF), "nope")).toBeNull()
  })
})
