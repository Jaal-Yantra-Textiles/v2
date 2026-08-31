/**
 * Canvas scene utilities — server-side Excalidraw helpers for the chat editor.
 *
 * The Excalidraw moodboard on `design.moodboard` (typed json column) is THE
 * canvas workspace for the shop's chat-based design editor:
 *
 *   - inspiration elements — the maker's curated references (moodboard v1)
 *   - canvas elements      — generated garment images, one image element per
 *                            generation, laid out in the canvas zone
 *
 * Each generation turn produces TWO candidate canvases (A/B). The shopper picks
 * one; the pick sets `customData.canvas.active` on that element and stamps
 * `design.thumbnail_url`. Unpicked candidates stay as alternatives in the
 * scene's history strip.
 *
 * Everything here mirrors the scene conventions the partner-ui already renders
 * (design-moodboard.tsx normalizeMoodboard): scene envelope
 * { type: "excalidraw", version: 2, source, elements, appState, files },
 * image elements with a `fileId` + persistent http `url`, and `customData`
 * markers with `isDeleted` tombstones. The shop's scene panel loads these
 * elements read-only — the tools write, the UI reads.
 *
 * 🔴 Model-first, NEVER design.metadata (the #1486 metadata-replace lesson):
 * canvases live as scene elements; the only load-bearing design column touched
 * is `thumbnail_url` (active pick).
 */

// ── Scene envelope ─────────────────────────────────────────────────────

export type CanvasScene = {
  type: "excalidraw"
  version: 2
  source: string
  elements: SceneElement[]
  appState: Record<string, any>
  files: Record<string, SceneFile>
}

/** The subset of Excalidraw element shape the tools write and the shop renders. */
export type SceneElement = {
  id: string
  type: "rectangle" | "text" | "image" | "frame"
  x: number
  y: number
  width: number | null
  height: number | null
  angle: number
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  strokeStyle: string
  roughness: number
  opacity: number
  roundness: Record<string, any> | null
  isDeleted: boolean
  boundElements: any[] | null
  updated: number
  link: string | null
  locked: boolean
  // image
  fileId?: string
  mimeType?: string
  // text
  text?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  containerId?: string | null
  lineHeight?: number
  // any element
  customData?: {
    source?: "inspiration" | "canvas" | "brief" | "system"
    canvas?: CanvasMarker
    [key: string]: any
  } | null
}

export type SceneFile = {
  id: string
  dataURL: string // persistent http URL (mirrors MediaFile.file_path)
  mimeType: string
  created: number
  lastRetrieved: number
}

/** Audit marker stamped on every generated canvas element. */
export type CanvasMarker = {
  id: string // canvas id (stable across scene rewrites)
  letter: "A" | "B" | null // candidate pair position, null once superseded
  kind: "initial" | "revision" | "layer"
  parent_canvas_id: string | null // lineage — the canvas this was generated from
  media_id: string | null // persisted MediaFile record
  prompt_used: string
  materials_prompt: string | null
  badges: Record<string, any> | null
  generated_at: string
  active: boolean
}

/** Longest scene we will persist. Guards a runaway model appending forever. */
export const MAX_CANVAS_ELEMENTS = 60

/** Canvas zone geometry — generated canvases lay out in a grid to the right. */
export const CANVAS_ZONE_X = 900
export const CANVAS_ZONE_Y = 0
export const CANVAS_WIDTH = 384
export const CANVAS_HEIGHT = 512
export const CANVAS_GAP = 24

const CANVAS_SOURCE = "https://excalidraw.com"

/**
 * PURE. Parse any stored moodboard value into a well-formed scene, preserving
 * every existing element (inspirations, brief cards, prior canvases).
 *
 * Accepts an object or a JSON string (legacy rows). Returns a fresh envelope
 * when nothing is stored yet — a new design starts with an empty scene.
 */
export function normalizeCanvasScene(raw: unknown): CanvasScene {
  let parsed: any = raw
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }

  const elements: SceneElement[] = Array.isArray(parsed?.elements)
    ? parsed.elements
    : []

  const files: Record<string, SceneFile> =
    parsed?.files && typeof parsed.files === "object" ? parsed.files : {}

  // Old UI convention: image elements may carry url/src without a matching
  // files entry — rebuild missing entries so the shop renderer can resolve them.
  for (const el of elements) {
    if (el?.type !== "image" || !el.fileId || files[el.fileId]) {
      continue
    }
    const url = typeof el.link === "string" ? el.link : undefined
    if (url && url.startsWith("http")) {
      files[el.fileId] = {
        id: el.fileId,
        dataURL: url,
        mimeType: el.mimeType || "image/png",
        created: Date.now(),
        lastRetrieved: Date.now(),
      }
    }
  }

  return {
    type: "excalidraw",
    version: 2,
    source: CANVAS_SOURCE,
    elements: elements.filter((el) => !el?.isDeleted),
    appState: parsed?.appState && typeof parsed.appState === "object" ? parsed.appState : {},
    files,
  }
}

/**
 * PURE. Compute the layout slot for the next canvas element — a 2-column grid
 * (A left, B right) growing downward in the canvas zone.
 */
export function canvasSlot(index: number): { x: number; y: number } {
  const column = index % 2
  const row = Math.floor(index / 2)
  return {
    x: CANVAS_ZONE_X + column * (CANVAS_WIDTH + CANVAS_GAP),
    y: CANVAS_ZONE_Y + row * (CANVAS_HEIGHT + CANVAS_GAP),
  }
}

/** PURE. Count the canvas elements currently in the scene. */
export function countCanvasElements(scene: CanvasScene): number {
  return scene.elements.filter((el) => el.customData?.canvas).length
}

/** PURE. Read all canvas elements in scene order (history strip). */
export function readCanvasElements(scene: CanvasScene): SceneElement[] {
  return scene.elements.filter((el) => !el.isDeleted && el.customData?.canvas)
}

/** PURE. Read the currently active canvas element, if one is marked. */
export function readActiveCanvas(scene: CanvasScene): SceneElement | null {
  const marked = readCanvasElements(scene).find(
    (el) => el.customData?.canvas?.active
  )
  return marked ?? null
}

/**
 * PURE. Build one candidate canvas element (image) ready to append to the
 * scene, with its files entry. The image is persisted media (commit mode):
 * `imageUrl` mirrors MediaFile.file_path.
 */
export function buildCanvasElement(input: {
  canvasId: string
  letter: "A" | "B"
  kind: CanvasMarker["kind"]
  parentCanvasId: string | null
  mediaId: string | null
  imageUrl: string
  mimeType?: string
  promptUsed: string
  materialsPrompt?: string | null
  badges?: Record<string, any> | null
  generatedAt: string
  slotIndex: number
}): { element: SceneElement; file: SceneFile } {
  const slot = canvasSlot(input.slotIndex)
  const fileId = `canvas-${input.canvasId}`
  const label = `Take ${input.letter}`

  return {
    element: {
      id: `el-${input.canvasId}`,
      type: "image",
      x: slot.x,
      y: slot.y,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: null,
      isDeleted: false,
      boundElements: null,
      updated: Date.now(),
      link: input.imageUrl,
      locked: true,
      fileId,
      mimeType: input.mimeType || "image/png",
      customData: {
        source: "canvas",
        label,
        canvas: {
          id: input.canvasId,
          letter: input.letter,
          kind: input.kind,
          parent_canvas_id: input.parentCanvasId,
          media_id: input.mediaId,
          prompt_used: input.promptUsed,
          materials_prompt: input.materialsPrompt ?? null,
          badges: input.badges ?? null,
          generated_at: input.generatedAt,
          active: false,
        },
      },
    },
    file: {
      id: fileId,
      dataURL: input.imageUrl,
      mimeType: input.mimeType || "image/png",
      created: Date.now(),
      lastRetrieved: Date.now(),
    },
  }
}

/**
 * PURE. Append candidate canvas elements to a scene.
 *
 * A generation turn appends TWO candidates (A/B) side by side. Tombstones
 * nothing — appending is additive; the unpicked candidate stays as an
 * alternative until the scene exceeds MAX_CANVAS_ELEMENTS, at which point the
 * oldest inactive canvases are tombstoned (isDeleted) to bound scene size.
 */
export function appendCanvasElements(
  scene: CanvasScene,
  candidates: Array<{
    canvasId: string
    letter: "A" | "B"
    kind: CanvasMarker["kind"]
    parentCanvasId: string | null
    mediaId: string | null
    imageUrl: string
    mimeType?: string
    promptUsed: string
    materialsPrompt?: string | null
    badges?: Record<string, any> | null
  }>,
  generatedAt: string
): CanvasScene {
  const elements = [...scene.elements]
  const files = { ...scene.files }
  const slotIndex = countCanvasElements({ ...scene, elements })

  for (const candidate of candidates) {
    const built = buildCanvasElement({
      canvasId: candidate.canvasId,
      letter: candidate.letter,
      kind: candidate.kind,
      parentCanvasId: candidate.parentCanvasId,
      mediaId: candidate.mediaId,
      imageUrl: candidate.imageUrl,
      mimeType: candidate.mimeType,
      promptUsed: candidate.promptUsed,
      materialsPrompt: candidate.materialsPrompt,
      badges: candidate.badges,
      generatedAt,
      slotIndex,
    })
    elements.push(built.element)
    files[built.file.id] = built.file
  }

  // Tombstone the oldest inactive canvases when over the cap — bound the scene.
  let canvasCount = elements.filter((el) => el.customData?.canvas).length
  let over = canvasCount - MAX_CANVAS_ELEMENTS
  if (over > 0) {
    const byAge = [...elements]
      .filter((el) => el.customData?.canvas && !el.customData.canvas.active)
      .sort((a, b) => a.updated - b.updated)
    for (const el of byAge) {
      if (over <= 0) break
      el.isDeleted = true
      canvasCount--
      over--
    }
  }

  return { ...scene, elements, files }
}

/**
 * PURE. Mark one canvas element as the active pick; unmark every other canvas
 * and flip its `letter` to null (the A/B pair is superseded by the pick).
 */
export function markActiveCanvas(
  scene: CanvasScene,
  canvasId: string
): CanvasScene {
  const elements = scene.elements.map((el) => {
    const marker = el.customData?.canvas
    if (!marker) return el
    const isPick = marker.id === canvasId
    return {
      ...el,
      customData: {
        ...el.customData,
        canvas: { ...marker, active: isPick, letter: isPick ? marker.letter : null },
      },
    }
  })
  return { ...scene, elements }
}

/**
 * PURE. Resolve the generation reference for the next canvas:
 * the active canvas image when one is picked (iteration builds on the picked
 * garment), otherwise null (the tool layer falls back to the base product
 * image, or brief-only for standalone designs).
 */
export function readGenerationReference(
  scene: CanvasScene
): string | null {
  const active = readActiveCanvas(scene)
  if (!active) return null
  const file = active.fileId ? scene.files[active.fileId] : null
  const url =
    file?.dataURL ||
    (typeof active.link === "string" ? active.link : null)
  return url && url.startsWith("http") ? url : null
}

/**
 * Add uploaded reference images to a scene as INSPIRATION elements.
 *
 * 🔑 Extracted from `storefront-design-flow`, which built these inline while
 * seeding a brand-new design. A second caller now needs the same shape — the
 * public reference-upload route, which drops photos onto a design that may
 * already exist — and a hand-copied twin is how the run-line pricer ended up
 * with two homes and a 22% gap between them.
 *
 * Inspiration elements are NOT canvases: they carry no `customData.canvas`, so
 * `readCanvasElements`, `readActiveCanvas` and the A/B pick logic all ignore
 * them. They are the maker's own photographs sitting on the board next to the
 * takes generated from them.
 *
 * `analysis` rides on the element as well as on the MediaFile so a later turn
 * can ground on the description without a second vision call — the same reason
 * the seed path stamped it there.
 */
export function appendInspirationElements(
  scene: CanvasScene,
  references: Array<{
    url: string
    media_id?: string | null
    analysis?: {
      title?: string | null
      description?: string | null
      suggestions?: string[]
      analyzed_at?: string | null
    } | null
  }>,
  now: number = Date.now()
): CanvasScene {
  const next: CanvasScene = {
    ...scene,
    elements: [...scene.elements],
    files: { ...scene.files },
  }

  for (const ref of references) {
    if (!ref?.url) continue
    // Already on the board — re-uploading the same photo must not double it.
    if (next.elements.some((el) => el.link === ref.url)) continue

    const fileId = `insp-${now}-${Math.random().toString(36).slice(2, 8)}`
    next.files[fileId] = {
      id: fileId,
      dataURL: ref.url,
      mimeType: "image/png",
      created: now,
      lastRetrieved: now,
    }
    next.elements.push({
      id: `el-${fileId}`,
      type: "image",
      x: 40 + (next.elements.length % 2) * 300,
      y: 40 + Math.floor(next.elements.length / 2) * 300,
      width: 260,
      height: 260,
      angle: 0,
      strokeColor: "transparent",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      roundness: null,
      isDeleted: false,
      boundElements: null,
      updated: now,
      link: ref.url,
      locked: true,
      fileId,
      mimeType: "image/png",
      customData: {
        source: "inspiration",
        ...(ref.media_id ? { media_id: ref.media_id } : {}),
        ...(ref.analysis
          ? {
              analysis: {
                title: ref.analysis.title ?? null,
                description: ref.analysis.description ?? null,
                suggestions: ref.analysis.suggestions ?? [],
                analyzed_at: ref.analysis.analyzed_at ?? null,
              },
            }
          : {}),
      },
    } as SceneElement)
  }

  return next
}
