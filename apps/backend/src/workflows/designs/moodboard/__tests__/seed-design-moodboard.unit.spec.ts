/**
 * Unit test — moodboard seed gating (#1113).
 *
 * Locks the decision logic of seedDesignMoodboardIfEmpty:
 *   - empty board + a brief  → build, persist, return the scene
 *   - board already has elements → no-op (never clobber), return null
 *   - nothing to render yet   → no-op, return null
 *
 * The scene building itself is covered by build-brief-frames/​build-moodboard-scene
 * specs; here we mock the design load + the persist workflow.
 *
 * 🔴 #2017 — the persist target is the design's CORE board row, NOT the legacy
 * `design.moodboard` column. While this wrote the column and the editor wrote
 * the row, a seed on a migrated design landed where nothing reads: every
 * resolver prefers the row and ignores the blob the moment one exists.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="seed-design-moodboard"
 */

const mockRun = jest.fn().mockResolvedValue({ result: {}, errors: [] })
jest.mock("../save-design-moodboard", () => ({
  __esModule: true,
  saveDesignMoodboardWorkflow: jest.fn(() => ({ run: mockRun })),
  default: jest.fn(() => ({ run: mockRun })),
}))

import { seedDesignMoodboardIfEmpty } from "../seed-design-moodboard"

/** Fake container scope whose QUERY.graph returns the given design row. */
function scopeFor(design: any) {
  const graph = jest.fn().mockResolvedValue({ data: design ? [design] : [] })
  return {
    resolve: () => ({ graph }),
  }
}

beforeEach(() => {
  mockRun.mockClear()
})

describe("seedDesignMoodboardIfEmpty", () => {
  it("seeds an empty board from the brief and persists it", async () => {
    const scope = scopeFor({
      id: "des_1",
      name: "Test",
      concept_theme: "90s Tokyo Streetwear",
      moodboard: null,
    })

    const scene = await seedDesignMoodboardIfEmpty(scope as any, "des_1")

    expect(scene).not.toBeNull()
    expect(scene!.elements.length).toBeGreaterThan(0)
    // Persisted exactly once, to the CORE BOARD, with the built scene.
    expect(mockRun).toHaveBeenCalledTimes(1)
    const input = mockRun.mock.calls[0][0].input
    expect(input.designId).toBe("des_1")
    expect(input.owner).toEqual({ type: "core" })
    expect(input.scene).toBe(scene)
    // …and NOT through the design-column door it used to use.
    expect(input.moodboard).toBeUndefined()
  })

  it("reads the CORE ROW, not the blob, when deciding the board is populated", async () => {
    // The state every migrated design is in: rows exist, the blob is stale.
    // Reading the blob here would re-seed on top of the owner's live board.
    const scope = scopeFor({
      id: "des_row",
      name: "Test",
      concept_theme: "Anything",
      moodboard: null,
      moodboards: [
        {
          id: "mb_1",
          owner_type: "core",
          partner_id: null,
          scene: { type: "excalidraw", elements: [{ id: "drawn-by-hand" }] },
        },
      ],
    })

    const scene = await seedDesignMoodboardIfEmpty(scope as any, "des_row")

    expect(scene).toBeNull()
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("a PARTNER board is not the core board — an empty core still seeds", async () => {
    const scope = scopeFor({
      id: "des_p",
      name: "Test",
      concept_theme: "90s Tokyo Streetwear",
      moodboard: null,
      moodboards: [
        {
          id: "mb_p",
          owner_type: "partner",
          partner_id: "p1",
          scene: { type: "excalidraw", elements: [{ id: "theirs" }] },
        },
      ],
    })

    const scene = await seedDesignMoodboardIfEmpty(scope as any, "des_p")

    expect(scene).not.toBeNull()
    expect(mockRun.mock.calls[0][0].input.owner).toEqual({ type: "core" })
  })

  it("the legacy blob is still the fallback for an unmigrated design", async () => {
    const scope = scopeFor({
      id: "des_2",
      name: "Test",
      concept_theme: "Anything",
      moodboard: { type: "excalidraw", elements: [{ id: "existing" }] },
    })

    const scene = await seedDesignMoodboardIfEmpty(scope as any, "des_2")

    expect(scene).toBeNull()
    expect(mockRun).not.toHaveBeenCalled()
  })

  it("no-ops when there's nothing to render yet (no brief, no tech-pack)", async () => {
    const scope = scopeFor({ id: "des_3", name: "Bare", moodboard: null })

    const scene = await seedDesignMoodboardIfEmpty(scope as any, "des_3")

    expect(scene).toBeNull()
    expect(mockRun).not.toHaveBeenCalled()
  })
})
