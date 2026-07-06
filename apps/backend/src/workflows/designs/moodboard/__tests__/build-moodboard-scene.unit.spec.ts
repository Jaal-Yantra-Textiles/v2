/**
 * Unit test — buildMoodboardScene / mergeFramesIntoScene (#892)
 *
 * Pure scene-builder tests. No DI, no DB. Asserts the Excalidraw scene contract,
 * frame grouping, image-file wiring, suggested-measurement dimming, determinism,
 * merge semantics, and the minimal-input path.
 *
 * Run:
 *   TEST_TYPE=unit npx jest --testPathPattern="build-moodboard-scene"
 */
import {
  buildMoodboardScene,
  mergeFramesIntoScene,
} from "../build-moodboard-scene"
import { SS26_CR_TP08 } from "./tech-pack.fixture"

describe("buildMoodboardScene", () => {
  const scene = buildMoodboardScene(SS26_CR_TP08)

  it("produces an excalidraw scene of version 2", () => {
    expect(scene.type).toBe("excalidraw")
    expect(scene.version).toBe(2)
  })

  it("builds 5 frames with the expected names", () => {
    const frames = scene.elements.filter((e) => e.type === "frame")
    expect(frames).toHaveLength(5)
    expect(frames.map((f) => f.name)).toEqual([
      "1 · Header & Flats",
      "2 · Measurements",
      "3 · Zoom details",
      "4 · Construction details",
      "5 · Colorways",
    ])
  })

  it("emits a construction-detail object (with params + fabricRules) per detail", () => {
    const detailAnchors = scene.elements.filter(
      (e) => (e.customData as { kind?: string })?.kind === "construction-detail"
    )
    expect(detailAnchors).toHaveLength(6)
    const techniques = detailAnchors.map(
      (e) => (e.customData as { technique?: string }).technique
    )
    expect(techniques).toEqual([
      "gathers",
      "dart",
      "knife-pleat",
      "topstitch",
      "yoke",
      "embroidery",
    ])
    // The dart carries its fabric-derived intake param and sewing rules.
    const dart = detailAnchors.find(
      (e) => (e.customData as { technique?: string }).technique === "dart"
    )
    expect((dart?.customData as { params?: Record<string, number> }).params).toEqual({
      intake: 0.6,
    })
    expect(
      (dart?.customData as { fabricRules?: string[] }).fabricRules
    ).toContain("clip at apex")
  })

  it("renders each known technique as native, editable line elements", () => {
    const glyphLines = scene.elements.filter(
      (e) =>
        e.type === "line" &&
        (e.customData as { kind?: string })?.kind === "construction-glyph"
    )
    expect(glyphLines.length).toBeGreaterThan(0)
    // topstitch requests dashed stitch rows — at least one glyph line is dashed.
    expect(glyphLines.some((e) => e.strokeStyle === "dashed")).toBe(true)
  })

  it("attaches every non-frame element to a frame (no orphans)", () => {
    const frameIds = new Set(
      scene.elements.filter((e) => e.type === "frame").map((f) => f.id)
    )
    const nonFrames = scene.elements.filter((e) => e.type !== "frame")
    expect(nonFrames.length).toBeGreaterThan(0)
    for (const el of nonFrames) {
      expect(frameIds.has(el.frameId ?? "")).toBe(true)
    }
  })

  it("registers a file for every image element's fileId", () => {
    const images = scene.elements.filter((e) => e.type === "image")
    expect(images.length).toBeGreaterThan(0)
    for (const img of images) {
      expect(img.fileId).toBeDefined()
      expect(scene.files[img.fileId as string]).toBeDefined()
    }
  })

  it("dims suggested measurement texts (opacity 50) and leaves spec ones at 100", () => {
    const texts = scene.elements.filter((e) => e.type === "text")
    const yoke = texts.find((t) => (t.text ?? "").includes("Yoke Drop"))
    const totalLength = texts.find((t) =>
      (t.text ?? "").includes("Total Length Hps")
    )
    expect(yoke).toBeDefined()
    expect(totalLength).toBeDefined()
    expect(yoke?.opacity).toBe(50)
    expect(totalLength?.opacity).toBe(100)
  })

  it("is deterministic — two builds of the same fixture are deeply equal", () => {
    const a = buildMoodboardScene(SS26_CR_TP08)
    const b = buildMoodboardScene(SS26_CR_TP08)
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b))
  })

  it("builds a minimal input without throwing and yields exactly 1 frame", () => {
    const minimal = buildMoodboardScene({
      design: { title: "Solo" },
      garment_type: "top",
      flats: {},
    })
    const frames = minimal.elements.filter((e) => e.type === "frame")
    expect(frames).toHaveLength(1)
    expect(frames[0].name).toBe("1 · Header & Flats")
  })
})

describe("mergeFramesIntoScene", () => {
  it("replaces same-named frames without duplicating element count", () => {
    const base = buildMoodboardScene(SS26_CR_TP08)
    const incoming = buildMoodboardScene(SS26_CR_TP08)
    const merged = mergeFramesIntoScene(base, incoming)
    // All frame names match → every base frame+child is dropped, incoming appended.
    expect(merged.elements).toHaveLength(base.elements.length)
  })
})
