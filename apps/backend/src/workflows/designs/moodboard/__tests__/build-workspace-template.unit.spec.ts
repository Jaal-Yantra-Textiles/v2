/**
 * Unit test — designer-workspace template (#1113).
 *
 * The structured board: Contents index + Design Specs / Materials reference
 * frames + a Workspace scaffold, plus the merge-safety that a refresh (which
 * omits the workspace) never clobbers the designer's own work.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="build-workspace-template"
 */
import {
  buildMoodboardScene,
  mergeFramesIntoScene,
  type TechPackSceneInput,
} from "../build-moodboard-scene"

const BASE: TechPackSceneInput = {
  design: { title: "Craft Top" },
  garment_type: "blouse",
  flats: {},
  brief: { concept_theme: "Handloom revival" },
  specs: [
    { title: "Fabric", category: "Material", details: "100% khadi cotton" },
    { title: "Wash", category: "Finishing", special_instructions: "cold only" },
  ],
  materials: [
    { name: "Khadi A", composition: "100% cotton", colors: ["Indigo", "Madder"] },
  ],
}

const frameNames = (scene: { elements: any[] }) =>
  scene.elements.filter((e) => e.type === "frame").map((f) => f.name)

describe("designer-workspace template", () => {
  it("without opts, emits neither a Contents nor a Workspace frame (non-breaking)", () => {
    const names = frameNames(buildMoodboardScene(BASE))
    expect(names).not.toContain("Contents")
    expect(names).not.toContain("Designer Workspace")
  })

  it("includeContents prepends a Contents index listing every section", () => {
    const scene = buildMoodboardScene(BASE, { includeContents: true })
    const names = frameNames(scene)
    expect(names[0]).toBe("Contents")
    // The index text lists the section frame names that follow it.
    const entries = scene.elements
      .filter((e) => e.customData?.kind === "contents-entry")
      .map((e) => e.customData?.section)
    expect(entries).toContain("Design Specs")
    expect(entries).toContain("Materials")
  })

  it("includeWorkspace appends a Designer Workspace scaffold with labelled zones", () => {
    const scene = buildMoodboardScene(BASE, { includeWorkspace: true })
    const names = frameNames(scene)
    expect(names[names.length - 1]).toBe("Designer Workspace")
    const zones = scene.elements
      .filter((e) => e.customData?.kind === "workspace-zone")
      .map((e) => e.customData?.label)
    expect(zones).toEqual(["Explorations", "Fabric & trims", "Notes"])
  })

  it("renders Design Specs cards from input.specs (any category)", () => {
    const scene = buildMoodboardScene(BASE)
    const specCards = scene.elements.filter(
      (e) => e.customData?.kind === "design-spec"
    )
    expect(specCards.map((c) => c.customData?.title)).toEqual(["Fabric", "Wash"])
  })

  it("renders Materials cards from input.materials", () => {
    const scene = buildMoodboardScene(BASE)
    const matCards = scene.elements.filter(
      (e) => e.customData?.kind === "material"
    )
    expect(matCards).toHaveLength(1)
    expect(matCards[0].customData?.name).toBe("Khadi A")
  })

  it("a refresh (no workspace) preserves the designer's Workspace frame + its children", () => {
    // First seed: board with the workspace scaffold + the designer's own note.
    const seeded = buildMoodboardScene(BASE, {
      includeContents: true,
      includeWorkspace: true,
    })
    const wsFrame = seeded.elements.find(
      (e) => e.type === "frame" && e.name === "Designer Workspace"
    )!
    const designerNote = {
      ...seeded.elements[0],
      id: "designer-note",
      type: "text",
      text: "my idea",
      frameId: wsFrame.id,
      customData: undefined,
    }
    const withWork = { ...seeded, elements: [...seeded.elements, designerNote] }

    // Refresh: rebuild WITHOUT the workspace, merge onto the worked board.
    const refresh = buildMoodboardScene(BASE, { includeContents: true })
    const merged = mergeFramesIntoScene(withWork as any, refresh)

    // Workspace frame + the designer's note survive; reference frames refreshed.
    expect(
      merged.elements.some(
        (e) => e.type === "frame" && e.name === "Designer Workspace"
      )
    ).toBe(true)
    expect(merged.elements.some((e) => e.id === "designer-note")).toBe(true)
    expect(
      merged.elements.some((e) => e.type === "frame" && e.name === "Design Specs")
    ).toBe(true)
  })
})
