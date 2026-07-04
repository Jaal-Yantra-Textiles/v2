/**
 * build-moodboard-scene.ts — pure, server-side scene builder for the AI tech-pack
 * moodboard (GitHub #892). Given a garment's flats + structured spec data, it emits
 * a complete Excalidraw scene (the exact shape persisted on `design.moodboard`, see
 * `apps/backend/src/admin/hooks/use-moodboard.ts:saveExcalidrawState`) as native,
 * editable elements grouped into frames — one frame ≈ one tech-pack page.
 *
 * ARCHITECTURE NOTE (decided 2026-07-05, do not "fix" back):
 * We hand-emit fully-qualified Excalidraw elements via `makeElement()` and do NOT use
 * `@excalidraw/excalidraw`'s `convertToExcalidrawElements()`. That package fails to
 * import in plain Node/Jest (it pulls browser-only JSON-import deps), so it cannot run
 * in this server-side, unit-tested lib. This module therefore stays dependency-free and
 * fully deterministic (seeded ids/nonces — no Date.now()/Math.random()), so its output
 * is byte-stable and unit-testable against a fixture.
 *
 * Measurements are AUTHORITATIVE only from `DesignSizeSet.measurements`
 * (`Record<string, number>`, see `size-set-utils.ts:NormalizedSizeSet`). There is no
 * unit field on the model, so the unit is passed in explicitly and rendered next to each
 * value. Values the caller marks `suggested` are rendered dimmed (vision guesses, not spec).
 */

// ── Public input contract ──────────────────────────────────────────────────────

export type MeasurementUnit = "cm" | "in"

export interface TechPackHeader {
  title: string
  style_code?: string
  season?: string
  category?: string
  capsule?: string
}

export interface TechPackFlats {
  /** CDN URL of the generated/segmented FRONT flat (already a moodboard file URL). */
  front_image_url?: string
  back_image_url?: string
}

export interface TechPackSizeSet {
  size_label: string
  /** Canonical measurement store: key → value in `unit`. From DesignSizeSet.measurements. */
  measurements: Record<string, number>
  unit: MeasurementUnit
  /** Keys whose values are vision-suggested (not from spec data) — rendered dimmed. */
  suggested?: string[]
}

export interface TechPackColorway {
  name: string
  hex_code: string
  /** Optional thread/yarn reference (e.g. a K-number) shown under the chip. */
  thread_ref?: string
}

/** A detected garment region for a zoom-lens crop (bbox in the flat's own px space). */
export interface TechPackRegion {
  label: string
  /** [x, y, w, h] within the source flat image. */
  bbox: [number, number, number, number]
  /** Spec note shown beside the lens (e.g. "flower emb 3.5 cm wide"). */
  note?: string
}

export interface TechPackSceneInput {
  design: TechPackHeader
  garment_type: string
  flats: TechPackFlats
  sizeSet?: TechPackSizeSet
  colorways?: TechPackColorway[]
  regions?: TechPackRegion[]
  /** Optional stable seed so ids/nonces are reproducible across builds. Default 1. */
  seed?: number
}

// ── Excalidraw scene / element shapes (local, minimal — matches saveExcalidrawState) ──

export interface ExcalidrawFile {
  id: string
  dataURL: string
  mimeType: string
  created: number
  lastRetrieved: number
}

export interface MoodboardScene {
  type: "excalidraw"
  version: 2
  source: string
  elements: ExcalidrawElement[]
  appState: {
    viewBackgroundColor: string
    gridSize: number | null
    theme: "light" | "dark"
  }
  files: Record<string, ExcalidrawFile>
}

/** Fully-qualified Excalidraw element (superset; unused fields default per makeElement). */
export interface ExcalidrawElement {
  id: string
  type:
    | "rectangle"
    | "ellipse"
    | "text"
    | "image"
    | "arrow"
    | "line"
    | "frame"
  x: number
  y: number
  width: number
  height: number
  angle: number
  strokeColor: string
  backgroundColor: string
  fillStyle: string
  strokeWidth: number
  strokeStyle: string
  roughness: number
  opacity: number
  groupIds: string[]
  frameId: string | null
  roundness: { type: number } | null
  seed: number
  version: number
  versionNonce: number
  isDeleted: boolean
  boundElements: { id: string; type: string }[] | null
  updated: number
  link: string | null
  locked: boolean
  // text-only
  text?: string
  fontSize?: number
  fontFamily?: number
  textAlign?: string
  verticalAlign?: string
  containerId?: string | null
  originalText?: string
  lineHeight?: number
  // image-only
  fileId?: string
  status?: "pending" | "saved"
  scale?: [number, number]
  // arrow/line-only
  points?: [number, number][]
  lastCommittedPoint?: [number, number] | null
  startBinding?: unknown
  endBinding?: unknown
  startArrowhead?: string | null
  endArrowhead?: string | null
  // frame-only
  name?: string
}

// ── Deterministic element factory ───────────────────────────────────────────────

/** Minimal skeleton the frame builders author; makeElement fills all boilerplate. */
export interface ElementSkeleton extends Partial<ExcalidrawElement> {
  type: ExcalidrawElement["type"]
  x: number
  y: number
  width: number
  height: number
}

/**
 * Deterministic id/nonce source. Given a seed, produces a monotonic sequence — so a
 * scene built twice from the same input is byte-identical (required for unit tests and
 * to avoid spurious moodboard diffs).
 */
export class SceneRng {
  private n: number
  constructor(seed = 1) {
    this.n = seed >>> 0
  }
  next(): number {
    // xorshift32 — deterministic, no Math.random.
    let x = this.n || 1
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.n = x >>> 0
    return this.n
  }
  id(prefix: string): string {
    return `${prefix}-${this.next().toString(36)}`
  }
}

/** Fill a skeleton into a fully-qualified, Excalidraw-valid element. */
export function makeElement(
  skel: ElementSkeleton,
  rng: SceneRng,
  frameId: string | null = null
): ExcalidrawElement {
  const base: ExcalidrawElement = {
    id: skel.id ?? rng.id(skel.type),
    type: skel.type,
    x: skel.x,
    y: skel.y,
    width: skel.width,
    height: skel.height,
    angle: skel.angle ?? 0,
    strokeColor: skel.strokeColor ?? "#1e1e1e",
    backgroundColor: skel.backgroundColor ?? "transparent",
    fillStyle: skel.fillStyle ?? "solid",
    strokeWidth: skel.strokeWidth ?? 1,
    strokeStyle: skel.strokeStyle ?? "solid",
    roughness: skel.roughness ?? 0,
    opacity: skel.opacity ?? 100,
    groupIds: skel.groupIds ?? [],
    frameId: skel.frameId ?? frameId,
    roundness: skel.roundness ?? null,
    seed: skel.seed ?? rng.next(),
    version: skel.version ?? 1,
    versionNonce: skel.versionNonce ?? rng.next(),
    isDeleted: false,
    boundElements: skel.boundElements ?? null,
    updated: skel.updated ?? 1,
    link: skel.link ?? null,
    locked: skel.locked ?? false,
  }
  if (skel.type === "text") {
    base.text = skel.text ?? ""
    base.originalText = skel.originalText ?? skel.text ?? ""
    base.fontSize = skel.fontSize ?? 16
    base.fontFamily = skel.fontFamily ?? 1
    base.textAlign = skel.textAlign ?? "left"
    base.verticalAlign = skel.verticalAlign ?? "top"
    base.containerId = skel.containerId ?? null
    base.lineHeight = skel.lineHeight ?? 1.25
  }
  if (skel.type === "image") {
    base.fileId = skel.fileId
    base.status = skel.status ?? "saved"
    base.scale = skel.scale ?? [1, 1]
  }
  if (skel.type === "arrow" || skel.type === "line") {
    base.points = skel.points ?? [
      [0, 0],
      [skel.width, skel.height],
    ]
    base.lastCommittedPoint = skel.lastCommittedPoint ?? null
    base.startBinding = skel.startBinding ?? null
    base.endBinding = skel.endBinding ?? null
    base.startArrowhead = skel.startArrowhead ?? null
    base.endArrowhead =
      skel.endArrowhead ?? (skel.type === "arrow" ? "arrow" : null)
  }
  if (skel.type === "frame") {
    base.name = skel.name ?? "Frame"
  }
  return base
}

// ── Layout constants (shared by all frame builders) ─────────────────────────────

export const FRAME = {
  width: 1200,
  height: 900,
  gap: 120, // horizontal gap between page-frames
  pad: 48, // inner padding
}

/** A frame builder returns the frame + its child elements and any image files. */
export interface FrameResult {
  elements: ExcalidrawElement[]
  files: Record<string, ExcalidrawFile>
}

/** Human label + `unit`-suffixed value, e.g. "Total length (HPS)  66 cm". */
export function formatMeasurement(
  key: string,
  value: number,
  unit: MeasurementUnit
): string {
  const label = key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
  return `${label}  ${value} ${unit}`
}

// ── REFERENCE FRAME BUILDER — copy this pattern for the other three ───────────────
//
// buildHeaderFlatsFrame is the fully-worked reference. buildMeasurementFrame,
// buildZoomLensFrame, and buildColorwayFrame (below) MUST mirror this structure:
//   1. a "frame" element at (originX, 0) sized FRAME.width × FRAME.height,
//   2. child elements authored as skeletons through makeElement(skel, rng, frameId),
//   3. every child's frameId === the frame's id, positioned WITHIN the frame bounds,
//   4. image children register a file in `files` keyed by fileId (dataURL = the URL;
//      moodboard files carry the URL in dataURL, see normalizeMoodboard in partner-ui),
//   5. return { elements: [frame, ...children], files }.

/**
 * Page 1 — header block + clean FRONT/BACK flats side by side.
 */
export function buildHeaderFlatsFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  // The frame's own id IS frameId — children reference it via frameId, so it must be
  // the same value (pass id explicitly; don't let makeElement generate a second one).
  const frameId = rng.id("frame")
  const frame = makeElement(
    {
      type: "frame",
      id: frameId,
      x: originX,
      y: 0,
      width: FRAME.width,
      height: FRAME.height,
      name: "1 · Header & Flats",
    },
    rng
  )

  const elements: ExcalidrawElement[] = [frame]
  const files: Record<string, ExcalidrawFile> = {}

  // Header text block (top-left).
  const { design, garment_type } = input
  const headerLines = [
    design.title,
    design.style_code && `Style  ${design.style_code}`,
    design.season && `Season  ${design.season}`,
    design.category && `Category  ${design.category}`,
    design.capsule && `Capsule  ${design.capsule}`,
    `Type  ${garment_type}`,
  ].filter(Boolean) as string[]

  elements.push(
    makeElement(
      {
        type: "text",
        x: originX + FRAME.pad,
        y: FRAME.pad,
        width: 420,
        height: headerLines.length * 24,
        text: headerLines.join("\n"),
        fontSize: 18,
        lineHeight: 1.35,
      },
      rng,
      frameId
    )
  )

  // FRONT + BACK flats side by side, below the header.
  const flatW = 420
  const flatH = 560
  const flatsY = FRAME.pad + headerLines.length * 28 + 40
  const flats: [string, string | undefined][] = [
    ["FRONT", input.flats.front_image_url],
    ["BACK", input.flats.back_image_url],
  ]
  flats.forEach(([caption, url], i) => {
    const flatX = originX + FRAME.pad + i * (flatW + 80)
    if (url) {
      const fileId = rng.id("file")
      files[fileId] = {
        id: fileId,
        dataURL: url,
        mimeType: "image/png",
        created: 1,
        lastRetrieved: 1,
      }
      elements.push(
        makeElement(
          {
            type: "image",
            x: flatX,
            y: flatsY,
            width: flatW,
            height: flatH,
            fileId,
          },
          rng,
          frameId
        )
      )
    } else {
      // Placeholder rectangle when the flat hasn't been generated yet.
      elements.push(
        makeElement(
          {
            type: "rectangle",
            x: flatX,
            y: flatsY,
            width: flatW,
            height: flatH,
            strokeColor: "#9e9e9e",
            strokeStyle: "dashed",
          },
          rng,
          frameId
        )
      )
    }
    elements.push(
      makeElement(
        {
          type: "text",
          x: flatX,
          y: flatsY + flatH + 12,
          width: flatW,
          height: 24,
          text: caption,
          fontSize: 16,
          textAlign: "center",
        },
        rng,
        frameId
      )
    )
  })

  return { elements, files }
}

// ── DELEGATED (see draft task): mirror buildHeaderFlatsFrame ─────────────────────
// buildMeasurementFrame(input, rng, originX)  — Page 2: flats + dimension callout
//     arrows (type:"arrow") with a bound/adjacent text per sizeSet.measurements entry,
//     via formatMeasurement(); suggested keys rendered at opacity 50.
// buildZoomLensFrame(input, rng, originX)     — Page 3: ellipse "lens" per region with
//     an arrow to a spec-note text (region.note).
// buildColorwayFrame(input, rng, originX)     — Page 5: a rectangle chip per colorway
//     (backgroundColor: hex_code) with name + thread_ref text under it.

// ── Scene assembler ──────────────────────────────────────────────────────────────

/**
 * Assemble the full moodboard scene: runs each applicable frame builder left-to-right
 * and merges their elements + files into one Excalidraw scene.
 */
export function buildMoodboardScene(input: TechPackSceneInput): MoodboardScene {
  const rng = new SceneRng(input.seed ?? 1)
  const builders: ((
    i: TechPackSceneInput,
    r: SceneRng,
    x: number
  ) => FrameResult)[] = [buildHeaderFlatsFrame]
  // NOTE: append buildMeasurementFrame / buildZoomLensFrame / buildColorwayFrame here
  // once implemented (guard each on the data it needs — sizeSet, regions, colorways).

  const elements: ExcalidrawElement[] = []
  let files: Record<string, ExcalidrawFile> = {}
  builders.forEach((build, i) => {
    const originX = i * (FRAME.width + FRAME.gap)
    const res = build(input, rng, originX)
    elements.push(...res.elements)
    files = { ...files, ...res.files }
  })

  return {
    type: "excalidraw",
    version: 2,
    source: "jyt:techpack-scene-builder",
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
      theme: "light",
    },
    files,
  }
}

/**
 * Merge freshly-built frames into an EXISTING scene without clobbering it. Required
 * because the moodboard is a full-scene replace (no incremental append API — see
 * `use-moodboard.ts:saveExcalidrawState`); a "regenerate one view" flow must
 * read-merge-write. Replaces any frame (and its children) whose `name` matches an
 * incoming frame; otherwise appends. Non-frame stray elements are preserved.
 */
export function mergeFramesIntoScene(
  existing: MoodboardScene | null | undefined,
  incoming: MoodboardScene
): MoodboardScene {
  if (!existing || !existing.elements?.length) return incoming

  const incomingFrameNames = new Set(
    incoming.elements.filter((e) => e.type === "frame").map((e) => e.name)
  )
  // Drop existing frames (and their children) that the incoming scene replaces.
  const replacedFrameIds = new Set(
    existing.elements
      .filter((e) => e.type === "frame" && incomingFrameNames.has(e.name))
      .map((e) => e.id)
  )
  const keptElements = existing.elements.filter(
    (e) => !replacedFrameIds.has(e.id) && !replacedFrameIds.has(e.frameId ?? "")
  )

  return {
    ...existing,
    elements: [...keptElements, ...incoming.elements],
    files: { ...existing.files, ...incoming.files },
  }
}
