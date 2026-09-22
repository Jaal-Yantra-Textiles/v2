import { describe, expect, it } from "vitest"
import {
  EMPTY_SCENE_SIGNATURE,
  moodboardSceneSignature,
} from "../moodboard-dirty"

/**
 * #2231 — Save was lit on a board nobody had touched.
 *
 * Each test below is one of the writes the editor makes on the partner's
 * behalf, and the assertion is that it does NOT read as work. The last group is
 * the other half of the contract: a real edit must still be seen, otherwise a
 * signature that never changes would pass every test above and lose a board.
 */

const frame = (over: Record<string, any> = {}) => ({
  id: "frame-1",
  type: "frame",
  x: 0,
  y: 0,
  width: 400,
  height: 300,
  name: "Palette",
  version: 12,
  versionNonce: 555,
  ...over,
})

const image = (over: Record<string, any> = {}) => ({
  id: "img-1",
  type: "image",
  x: 20,
  y: 20,
  width: 120,
  height: 120,
  fileId: "file-a",
  frameId: "frame-1",
  version: 3,
  versionNonce: 777,
  ...over,
})

describe("moodboardSceneSignature — what must NOT count as an edit", () => {
  it("is unchanged when the viewport moves (scrollToContent / zoom)", () => {
    // The viewport lives in appState, which the signature never reads.
    const elements = [frame(), image()]
    expect(moodboardSceneSignature(elements)).toBe(
      moodboardSceneSignature([...elements])
    )
  })

  it("is unchanged when the image inlining swaps files (#2228)", () => {
    // Inlining rewrites files[id].dataURL and leaves elements alone; the
    // element still points at the same fileId.
    const before = [frame(), image({ fileId: "file-a" })]
    const after = [frame(), image({ fileId: "file-a" })]
    expect(moodboardSceneSignature(after)).toBe(
      moodboardSceneSignature(before)
    )
  })

  it("is unchanged when Excalidraw bumps version/versionNonce on restore", () => {
    const loaded = [frame(), image()]
    const restored = [
      frame({ version: 40, versionNonce: 1 }),
      image({ version: 41, versionNonce: 2 }),
    ]
    expect(moodboardSceneSignature(restored)).toBe(
      moodboardSceneSignature(loaded)
    )
  })

  it("is unchanged by sub-pixel float noise", () => {
    expect(moodboardSceneSignature([frame({ x: 100.0001 })])).toBe(
      moodboardSceneSignature([frame({ x: 100 })])
    )
  })

  it("treats a re-push of the same scene as the same scene", () => {
    const scene = [frame(), image()]
    const rePushed = scene.map((el) => ({ ...el }))
    expect(moodboardSceneSignature(rePushed)).toBe(
      moodboardSceneSignature(scene)
    )
  })

  it("starts a board with nothing on it at the empty baseline", () => {
    expect(moodboardSceneSignature([])).toBe(EMPTY_SCENE_SIGNATURE)
    expect(moodboardSceneSignature(null)).toBe(EMPTY_SCENE_SIGNATURE)
    expect(moodboardSceneSignature(undefined)).toBe(EMPTY_SCENE_SIGNATURE)
  })
})

describe("moodboardSceneSignature — what MUST count as an edit", () => {
  const base = [frame(), image()]
  const sig = moodboardSceneSignature(base)

  it("sees an element move", () => {
    expect(moodboardSceneSignature([frame(), image({ x: 300 })])).not.toBe(sig)
  })

  it("sees an element added", () => {
    expect(
      moodboardSceneSignature([...base, image({ id: "img-2" })])
    ).not.toBe(sig)
  })

  it("sees an element deleted (Excalidraw tombstones rather than removes)", () => {
    expect(
      moodboardSceneSignature([frame(), image({ isDeleted: true })])
    ).not.toBe(sig)
  })

  it("sees a frame renamed", () => {
    expect(
      moodboardSceneSignature([frame({ name: "Fabrics" }), image()])
    ).not.toBe(sig)
  })

  it("sees text edited", () => {
    const withText = [frame(), { id: "t", type: "text", text: "silk" }]
    expect(moodboardSceneSignature(withText)).not.toBe(
      moodboardSceneSignature([frame(), { id: "t", type: "text", text: "wool" }])
    )
  })

  it("sees the layers panel hide a frame (opacity 0 + locked)", () => {
    expect(
      moodboardSceneSignature([frame({ opacity: 0, locked: true }), image()])
    ).not.toBe(sig)
  })

  it("sees z-order change", () => {
    expect(moodboardSceneSignature([image(), frame()])).not.toBe(sig)
  })

  it("sees a line's points redrawn", () => {
    const line = (pts: number[][]) => [{ id: "l", type: "line", points: pts }]
    expect(moodboardSceneSignature(line([[0, 0], [10, 10]]))).not.toBe(
      moodboardSceneSignature(line([[0, 0], [10, 90]]))
    )
  })
})
