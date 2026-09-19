import {
  canWriteBoard,
  coreScene,
  LEGACY_BOARD_ID,
  resolveBoards,
  type MoodboardRow,
} from "../moodboard-ownership"

const core = (over: Partial<MoodboardRow> = {}): MoodboardRow => ({
  id: "mb_core",
  owner_type: "core",
  partner_id: null,
  ...over,
})
const partner = (id: string, over: Partial<MoodboardRow> = {}): MoodboardRow => ({
  id: `mb_${id}`,
  owner_type: "partner",
  partner_id: id,
  ...over,
})
const scene = { elements: [{ type: "frame", id: "f" }] }

describe("resolveBoards — with rows", () => {
  it("gives the admin the core board and the partners' as read-only", () => {
    const r = resolveBoards([core(), partner("p1"), partner("p2")], null, {
      type: "core",
    })
    expect(r.own?.id).toBe("mb_core")
    expect(r.own?.is_own).toBe(true)
    expect(r.others.map((o) => o.id)).toEqual(["mb_p1", "mb_p2"])
    expect(r.others.every((o) => !o.is_own)).toBe(true)
  })

  it("gives a partner THEIR board and everyone else's as read-only", () => {
    const r = resolveBoards([core(), partner("p1"), partner("p2")], null, {
      type: "partner",
      partnerId: "p2",
    })
    expect(r.own?.id).toBe("mb_p2")
    expect(r.others.map((o) => o.id)).toEqual(["mb_core", "mb_p1"])
  })

  it("gives a partner with no board of their own a null own", () => {
    const r = resolveBoards([core(), partner("p1")], null, {
      type: "partner",
      partnerId: "p9",
    })
    expect(r.own).toBeNull()
    expect(r.others).toHaveLength(2)
  })

  it("compares partner ids as strings", () => {
    const r = resolveBoards([partner("7")], null, {
      type: "partner",
      partnerId: "7",
    })
    expect(r.own?.id).toBe("mb_7")
  })
})

/**
 * 🔴 The whole point of keeping `design.moodboard`. An empty row read and "no
 * boards exist" are the same value and opposite facts — a design written
 * before #2017 has its scene in the column and no rows at all.
 */
describe("resolveBoards — the legacy fallback", () => {
  it("shows the blob when there are NO rows", () => {
    const r = resolveBoards([], scene, { type: "core" })
    expect(r.usedLegacyFallback).toBe(true)
    expect(r.own?.id).toBe(LEGACY_BOARD_ID)
    expect(r.own?.is_legacy).toBe(true)
    expect(r.own?.scene).toBe(scene)
  })

  it("presents the blob to a PARTNER as someone else's, read-only", () => {
    const r = resolveBoards([], scene, { type: "partner", partnerId: "p1" })
    expect(r.own).toBeNull()
    expect(r.others[0]?.id).toBe(LEGACY_BOARD_ID)
    expect(r.others[0]?.is_own).toBe(false)
  })

  it("ignores an EMPTY blob rather than minting a blank board", () => {
    for (const empty of [null, undefined, {}, { elements: [] }, "nope", 7]) {
      const r = resolveBoards([], empty, { type: "core" })
      expect(r.own).toBeNull()
      expect(r.usedLegacyFallback).toBe(false)
    }
  })

  /**
   * 🔴 Once ANY row exists the blob is ignored. A half-migrated design showing
   * both would double every frame on the canvas.
   */
  it("ignores the blob entirely once a row exists", () => {
    const r = resolveBoards([partner("p1")], scene, { type: "core" })
    expect(r.usedLegacyFallback).toBe(false)
    expect(r.own).toBeNull()
    expect(r.others).toHaveLength(1)
    expect(r.others[0].is_legacy).toBe(false)
  })
})

describe("canWriteBoard", () => {
  it("lets each owner write their own", () => {
    expect(canWriteBoard(core(), { type: "core" })).toBe(true)
    expect(
      canWriteBoard(partner("p1"), { type: "partner", partnerId: "p1" })
    ).toBe(true)
  })

  /** The defect the entity exists to fix, asserted directly. */
  it("refuses a partner writing the CORE board", () => {
    expect(canWriteBoard(core(), { type: "partner", partnerId: "p1" })).toBe(
      false
    )
  })

  it("refuses a partner writing ANOTHER partner's board", () => {
    expect(
      canWriteBoard(partner("p1"), { type: "partner", partnerId: "p2" })
    ).toBe(false)
  })

  it("refuses an admin writing a partner's board", () => {
    expect(canWriteBoard(partner("p1"), { type: "core" })).toBe(false)
  })

  it("refuses a missing board", () => {
    expect(canWriteBoard(null, { type: "core" })).toBe(false)
    expect(canWriteBoard(undefined, { type: "core" })).toBe(false)
  })
})

/**
 * #2017 — every admin-side producer (editor save, brief seed, tech-pack
 * generate) has to agree on what is currently on the core board before it
 * merges onto it. While `generate` read and wrote the legacy column and the
 * editor read and wrote the row, a generate on a migrated design landed where
 * nothing reads.
 */
describe("coreScene", () => {
  const rowScene = { elements: [{ id: "row" }] }
  const blobScene = { elements: [{ id: "blob" }] }

  it("prefers the core row over the legacy blob", () => {
    expect(coreScene([core({ scene: rowScene })], blobScene)).toBe(rowScene)
  })

  it("falls back to the blob when there is no core row at all", () => {
    expect(coreScene([], blobScene)).toBe(blobScene)
    expect(coreScene(null, blobScene)).toBe(blobScene)
  })

  it("a partner row is not a core row — the blob still answers", () => {
    expect(coreScene([partner("p1", { scene: rowScene })], blobScene)).toBe(blobScene)
  })

  it("an EMPTY core row wins over a populated blob", () => {
    // "migrated then cleared" is not "predates the entity". Falling back here
    // would resurrect frames their owner deleted.
    expect(coreScene([core({ scene: null })], blobScene)).toBeNull()
  })

  it("no row and no blob is null, not undefined", () => {
    expect(coreScene([], null)).toBeNull()
    expect(coreScene([], undefined)).toBeNull()
  })
})
