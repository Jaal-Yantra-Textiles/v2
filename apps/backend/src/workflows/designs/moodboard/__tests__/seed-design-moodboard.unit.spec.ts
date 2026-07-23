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
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="seed-design-moodboard"
 */

const mockRun = jest.fn().mockResolvedValue({ result: {}, errors: [] })
jest.mock("../../update-design", () => ({
  __esModule: true,
  updateDesignWorkflow: jest.fn(() => ({ run: mockRun })),
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
    // Persisted exactly once with the built scene.
    expect(mockRun).toHaveBeenCalledTimes(1)
    expect(mockRun.mock.calls[0][0].input.id).toBe("des_1")
    expect(mockRun.mock.calls[0][0].input.moodboard).toBe(scene)
  })

  it("never clobbers a board that already has elements", async () => {
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
