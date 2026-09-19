import { describe, expect, it } from "vitest"

import {
  normalizeMoodboardScene,
  summarizeMoodboardScene,
} from "../moodboard-scene"

const frame = (over: Record<string, unknown> = {}) => ({
  type: "frame",
  id: "f1",
  ...over,
})
const rect = (over: Record<string, unknown> = {}) => ({
  type: "rectangle",
  id: "r1",
  ...over,
})

describe("normalizeMoodboardScene", () => {
  it("returns null for an empty board", () => {
    expect(normalizeMoodboardScene(null)).toBeNull()
    expect(normalizeMoodboardScene(undefined)).toBeNull()
    expect(normalizeMoodboardScene("")).toBeNull()
  })

  /**
   * The editor has always accepted a serialized scene. The card must agree, or
   * the two surfaces disagree about whether a board exists at all.
   */
  it("parses a scene that arrives as a JSON string", () => {
    const scene = normalizeMoodboardScene(
      JSON.stringify({ elements: [frame()], appState: { zoom: 1 } })
    )
    expect(scene?.elements).toHaveLength(1)
    expect(scene?.appState).toEqual({ zoom: 1 })
  })

  it("returns null for a string that is not JSON", () => {
    expect(normalizeMoodboardScene("{not json")).toBeNull()
  })

  it("returns null for a non-object, including an array", () => {
    expect(normalizeMoodboardScene(42)).toBeNull()
    expect(normalizeMoodboardScene([frame()])).toBeNull()
  })

  it("defaults elements to an array when the column holds a shapeless object", () => {
    expect(normalizeMoodboardScene({ appState: {} })?.elements).toEqual([])
  })
})

describe("summarizeMoodboardScene", () => {
  it("reports an unstarted board", () => {
    expect(summarizeMoodboardScene(null)).toEqual({
      hasContent: false,
      frameCount: 0,
      elementCount: 0,
    })
  })

  it("counts frames apart from everything else", () => {
    expect(
      summarizeMoodboardScene({
        elements: [frame({ id: "a" }), frame({ id: "b" }), rect(), rect({ id: "r2" })],
      })
    ).toEqual({ hasContent: true, frameCount: 2, elementCount: 2 })
  })

  /**
   * 🔴 Excalidraw TOMBSTONES rather than removes. Without this a board someone
   * emptied still reports content, and the card invites you into a blank
   * canvas it just told you had four frames on it.
   */
  it("ignores deleted elements", () => {
    expect(
      summarizeMoodboardScene({
        elements: [
          frame({ isDeleted: true }),
          rect({ isDeleted: true }),
          rect({ id: "live" }),
        ],
      })
    ).toEqual({ hasContent: true, frameCount: 0, elementCount: 1 })
  })

  it("reports no content when every element is deleted", () => {
    expect(
      summarizeMoodboardScene({
        elements: [frame({ isDeleted: true }), rect({ isDeleted: true })],
      }).hasContent
    ).toBe(false)
  })

  it("survives junk in the elements array", () => {
    expect(
      summarizeMoodboardScene({ elements: [null, "nope", 7, frame()] })
    ).toEqual({ hasContent: true, frameCount: 1, elementCount: 0 })
  })

  it("summarizes a stringified scene the same as an object one", () => {
    const obj = { elements: [frame(), rect()] }
    expect(summarizeMoodboardScene(JSON.stringify(obj))).toEqual(
      summarizeMoodboardScene(obj)
    )
  })
})
