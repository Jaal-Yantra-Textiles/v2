/**
 * Decide whether a moodboard has unsaved WORK in it (#2231).
 *
 * The editor used to answer this with a flag: Excalidraw's `onChange` set
 * `isDirty` to true, and every place that wrote to the canvas on the partner's
 * behalf set it back to false. That cannot work, because `onChange` is
 * asynchronous — the scene push on open, `scrollToContent`, the #2228 image
 * inlining all fire it a tick AFTER the clear has run. Save was lit on a board
 * nobody had touched, and re-lit itself immediately after a successful save.
 *
 * 🔴 The obvious repair — suppress the change events we cause ourselves —
 * was tried and reverted: it put the editor into `Maximum update depth
 * exceeded` the moment the Layers panel opened. Gates, timers and depth
 * counters all add state that the change handler both reads and writes, which
 * is the loop.
 *
 * So dirtiness is DERIVED instead. We keep a signature of the scene as we last
 * wrote or saved it and compare it to the scene we are handed. Nothing has to
 * be suppressed, because the things we do to the canvas on the partner's behalf
 * do not change the signature:
 *
 *   - `scrollToContent` moves the viewport, which lives in `appState`;
 *   - the image inlining replaces `files`, not elements;
 *   - re-pushing the same scene re-pushes the same elements.
 *
 * and a real edit does. The comparison is also idempotent, so a handler that
 * runs a hundred times during a drag sets the same value a hundred times and
 * React bails out of all but the first.
 */

/** Only the fields that describe the drawing; anything else is viewport. */
type SceneElementLike = Record<string, any>

/**
 * ⚠️ Deliberately NOT `version`/`versionNonce`. Excalidraw bumps those on
 * restore and normalization as well as on edits, so a signature built from them
 * goes stale on its own after a load — the exact failure this replaces. The
 * fields below are the ones a partner can actually change.
 */
const TRACKED_FIELDS = [
  "type",
  "x",
  "y",
  "width",
  "height",
  "angle",
  "text",
  "fontSize",
  "fontFamily",
  "textAlign",
  "verticalAlign",
  "strokeColor",
  "backgroundColor",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "roughness",
  "opacity",
  "roundness",
  "locked",
  "frameId",
  "containerId",
  "fileId",
  "name",
  "link",
  "startBinding",
  "endBinding",
] as const

/** Geometry arrives as floats; a sub-pixel difference is not an edit. */
const round = (v: unknown): unknown =>
  typeof v === "number" ? Math.round(v * 100) / 100 : v

const normalize = (v: unknown): unknown => {
  if (Array.isArray(v)) {
    return v.map(normalize)
  }
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = normalize((v as Record<string, unknown>)[k])
    }
    return out
  }
  return round(v)
}

/** The signature of a board with nothing on it — the starting baseline. */
export const EMPTY_SCENE_SIGNATURE = "0|"

/**
 * A stable string for a scene's elements.
 *
 * Order is part of it: z-order is something the partner can change, so two
 * scenes holding the same elements stacked differently are not the same scene.
 * Deleted elements are kept — Excalidraw tombstones rather than removes, and a
 * deletion is the edit we would otherwise miss.
 */
export const moodboardSceneSignature = (
  elements: readonly SceneElementLike[] | null | undefined
): string => {
  if (!Array.isArray(elements)) {
    return EMPTY_SCENE_SIGNATURE
  }
  const parts = elements.map((el) => {
    if (!el || typeof el !== "object") {
      return "?"
    }
    const picked: Record<string, unknown> = {
      id: el.id ?? "",
      deleted: !!el.isDeleted,
    }
    for (const f of TRACKED_FIELDS) {
      if (el[f] !== undefined) {
        picked[f] = normalize(el[f])
      }
    }
    // `points` is the line/arrow geometry — an array of [x, y] pairs.
    if (Array.isArray(el.points)) {
      picked.points = normalize(el.points)
    }
    return JSON.stringify(picked)
  })
  return `${parts.length}|${parts.join("|")}`
}
