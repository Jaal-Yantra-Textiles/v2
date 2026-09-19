/**
 * Pure readers for a design's moodboard scene (#2019).
 *
 * The scene lives in `design.moodboard` — today a single JSON column shared by
 * whoever opens it (#2017 will split it into one row per owner). Two surfaces
 * need to read it: the editor, and the entry card on the design detail page
 * that until now rendered a heading, one line of copy and a link, having
 * discarded the `design` prop it was handed.
 *
 * Extracted here rather than exported from the editor route so the card does
 * not pull Excalidraw in to count frames, and so the parsing is testable
 * without a canvas.
 */

/**
 * Generic over the element/file types so the editor can keep its Excalidraw
 * types while the entry card, which only counts, stays free of them.
 *
 * ⚠️ The parameters are a PROMISE this function does not verify — it checks
 * that `elements` is an array, never what is in it. That is the same trust the
 * editor's own parser always made, and the reason `summarizeMoodboardScene`
 * below re-checks each element's shape instead of assuming it.
 */
export type MoodboardSceneLike<TElement = unknown, TFile = unknown> = {
  elements: TElement[]
  appState?: Record<string, any>
  files?: Record<string, TFile>
}

/**
 * Parse whatever the column hands us into a scene, or null.
 *
 * 🔑 Accepts a STRING as well as an object. The column is `model.json()`, but
 * the value comes back as serialized JSON often enough that the editor has
 * always handled both — dropping that here would make the card disagree with
 * the editor about whether a board exists.
 */
export const normalizeMoodboardScene = <TElement = unknown, TFile = unknown>(
  raw: unknown
): MoodboardSceneLike<TElement, TFile> | null => {
  if (!raw) {
    return null
  }

  let parsed: any = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null
  }

  return {
    elements: Array.isArray(parsed.elements) ? parsed.elements : [],
    appState:
      parsed.appState && typeof parsed.appState === "object"
        ? parsed.appState
        : undefined,
    files:
      parsed.files && typeof parsed.files === "object" ? parsed.files : undefined,
  }
}

export type MoodboardSummary = {
  /** Has anyone put anything on this board yet? */
  hasContent: boolean
  /** Named frames — the unit a designer actually thinks in. */
  frameCount: number
  /** Everything else on the canvas, frames excluded. */
  elementCount: number
}

/**
 * What the entry card can honestly say about a board without opening it.
 *
 * 🔴 Deliberately NOT "last edited". The only timestamp available is
 * `design.updated_at`, which moves when anyone touches any design field — a
 * spec edit, a status change, a cost. Labelling that as when the board was
 * last worked on would be a confident lie on the face of a card, and the card
 * exists precisely because the section used to say nothing true. A real
 * board-level timestamp arrives with the `design_moodboard` row (#2017).
 *
 * Deleted elements are excluded: Excalidraw tombstones rather than removes, so
 * a board someone emptied would otherwise still report content.
 */
export const summarizeMoodboardScene = (raw: unknown): MoodboardSummary => {
  const scene = normalizeMoodboardScene(raw)
  if (!scene) {
    return { hasContent: false, frameCount: 0, elementCount: 0 }
  }

  let frameCount = 0
  let elementCount = 0
  for (const el of scene.elements) {
    const e = el as { type?: unknown; isDeleted?: unknown } | null
    if (!e || typeof e !== "object" || e.isDeleted === true) {
      continue
    }
    if (e.type === "frame") {
      frameCount += 1
    } else {
      elementCount += 1
    }
  }

  return {
    hasContent: frameCount + elementCount > 0,
    frameCount,
    elementCount,
  }
}
