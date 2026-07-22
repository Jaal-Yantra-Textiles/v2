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

/**
 * A construction detail — the "detail = triple" object from E1: a named technique
 * whose geometry is *derived* from fabric-set `params`, plus the `fabricRules`
 * (interface / clip / press / grade) that make it sewable. Rendered as a native,
 * editable Excalidraw line-drawing (not raster); the full object rides along on the
 * label element's `customData` so downstream tools can round-trip it.
 */
export interface TechPackDetail {
  /** Renderer key, e.g. "dart" | "knife-pleat" | "gathers". */
  technique: string
  /** Human label, e.g. "Waist dart" or "Sleeve-head gathers". */
  label: string
  /** Fabric-derived geometry params (intake, count, ratio, depth…). */
  params?: Record<string, number>
  /** Sewing rules — interface / clip / press / grade notes. */
  fabricRules?: string[]
  /** Optional spec note shown under the glyph. */
  note?: string
}

/** One Key Milestone on the timeline (initial sketches, first revisions, …). */
export interface TechPackMilestone {
  label: string
  /** ISO date string (or any short date label). Optional — TBD milestones show "—". */
  date?: string | null
}

/**
 * The design brief (#604) rendered as the moodboard's anchor cards (#1113 S2).
 * Every section is optional; a brief frame is only emitted when its section has
 * content, so a sparse brief still yields a clean board.
 */
export interface TechPackBrief {
  // Section 1 — Core Identity & Concept.
  concept_theme?: string | null
  /** Aesthetic Anchor — 3–5 keywords ("utilitarian", "sleek", "nostalgic"). */
  aesthetic_keywords?: string[] | null
  // Section 2 — Target Audience & Market Positioning.
  persona?: {
    age_range?: string | null
    lifestyle?: string | null
    values?: string[] | null
    pain_points?: string[] | null
  } | null
  competitors?: Array<{
    name: string
    url?: string | null
    differentiator?: string | null
  }> | null
  price_point?: "luxury" | "mid_market" | "budget" | null
  // Section 3 — Timeline & Budget.
  milestones?: TechPackMilestone[] | null
  design_budget?: number | null
  cost_currency?: string | null
  target_completion_date?: string | null
}

export interface TechPackSceneInput {
  design: TechPackHeader
  garment_type: string
  flats: TechPackFlats
  /** Design brief → the "Brief" anchor frames (rendered first). */
  brief?: TechPackBrief
  sizeSet?: TechPackSizeSet
  colorways?: TechPackColorway[]
  regions?: TechPackRegion[]
  /** Construction details → the "4 · Construction details" frame. */
  details?: TechPackDetail[]
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
  // any element — opaque app data (e.g. a construction detail's technique/params).
  // Only serialized when present, so elements that omit it stay byte-identical.
  customData?: Record<string, unknown>
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
  // Only attach when provided — keeps elements that don't use it byte-identical.
  if (skel.customData !== undefined) {
    base.customData = skel.customData
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

// ── Frame builders (mirror buildHeaderFlatsFrame) ───────────────────────────────

/**
 * Page 2 — measurement callouts. One row per `sizeSet.measurements` entry: a short
 * right-pointing arrow + a `formatMeasurement()` text label. Vision-suggested keys
 * (listed in `sizeSet.suggested`) render dimmed (opacity 50).
 */
export function buildMeasurementFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  const frameId = rng.id("frame")
  const frame = makeElement(
    {
      type: "frame",
      id: frameId,
      x: originX,
      y: 0,
      width: FRAME.width,
      height: FRAME.height,
      name: "2 · Measurements",
    },
    rng
  )

  const elements: ExcalidrawElement[] = [frame]
  const files: Record<string, ExcalidrawFile> = {}

  if (!input.sizeSet) {
    elements.push(
      makeElement(
        {
          type: "text",
          x: originX + FRAME.pad,
          y: FRAME.pad,
          width: 300,
          height: 24,
          text: "No measurements",
          fontSize: 18,
        },
        rng,
        frameId
      )
    )
    return { elements, files }
  }

  const { measurements, unit, suggested } = input.sizeSet
  const suggestedSet = new Set(suggested ?? [])
  const rowGap = 40
  const arrowW = 60
  const labelX = originX + FRAME.pad + arrowW + 16

  Object.entries(measurements).forEach(([key, value], i) => {
    const rowY = FRAME.pad + i * rowGap
    elements.push(
      makeElement(
        {
          type: "arrow",
          x: originX + FRAME.pad,
          y: rowY,
          width: arrowW,
          height: 0,
          points: [
            [0, 0],
            [arrowW, 0],
          ],
        },
        rng,
        frameId
      )
    )
    elements.push(
      makeElement(
        {
          type: "text",
          x: labelX,
          y: rowY - 12,
          width: 420,
          height: 24,
          text: formatMeasurement(key, value, unit),
          fontSize: 16,
          opacity: suggestedSet.has(key) ? 50 : 100,
        },
        rng,
        frameId
      )
    )
  })

  return { elements, files }
}

/**
 * Page 3 — zoom-lens detail callouts. Per region: an ellipse "lens" with an arrow to a
 * text showing `region.label` (and `region.note` on the next line when present).
 */
export function buildZoomLensFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  const frameId = rng.id("frame")
  const frame = makeElement(
    {
      type: "frame",
      id: frameId,
      x: originX,
      y: 0,
      width: FRAME.width,
      height: FRAME.height,
      name: "3 · Zoom details",
    },
    rng
  )

  const elements: ExcalidrawElement[] = [frame]
  const files: Record<string, ExcalidrawFile> = {}

  const regions = input.regions ?? []
  if (regions.length === 0) {
    elements.push(
      makeElement(
        {
          type: "text",
          x: originX + FRAME.pad,
          y: FRAME.pad,
          width: 300,
          height: 24,
          text: "No detail regions",
          fontSize: 18,
        },
        rng,
        frameId
      )
    )
    return { elements, files }
  }

  const lensW = 160
  const lensH = 160
  const rowGap = 220
  const textX = originX + FRAME.pad + lensW + 80

  regions.forEach((region, i) => {
    const rowY = FRAME.pad + i * rowGap
    elements.push(
      makeElement(
        {
          type: "ellipse",
          x: originX + FRAME.pad,
          y: rowY,
          width: lensW,
          height: lensH,
          strokeColor: "#1e1e1e",
          backgroundColor: "transparent",
          fillStyle: "solid",
        },
        rng,
        frameId
      )
    )
    elements.push(
      makeElement(
        {
          type: "arrow",
          x: originX + FRAME.pad + lensW,
          y: rowY + lensH / 2,
          width: 80,
          height: 0,
          points: [
            [0, 0],
            [80, 0],
          ],
        },
        rng,
        frameId
      )
    )
    const noteLines = [region.label, region.note].filter(Boolean) as string[]
    elements.push(
      makeElement(
        {
          type: "text",
          x: textX,
          y: rowY + lensH / 2 - 12,
          width: 360,
          height: noteLines.length * 22,
          text: noteLines.join("\n"),
          fontSize: 16,
          lineHeight: 1.35,
        },
        rng,
        frameId
      )
    )
  })

  return { elements, files }
}

/**
 * Page 5 — colorway chips. Per colorway: a solid rectangle chip filled with
 * `hex_code`, the colorway `name` under it, and a `Thread <ref>` line when
 * `thread_ref` is present. Chips laid out left-to-right.
 */
export function buildColorwayFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  const frameId = rng.id("frame")
  const frame = makeElement(
    {
      type: "frame",
      id: frameId,
      x: originX,
      y: 0,
      width: FRAME.width,
      height: FRAME.height,
      name: "5 · Colorways",
    },
    rng
  )

  const elements: ExcalidrawElement[] = [frame]
  const files: Record<string, ExcalidrawFile> = {}

  const colorways = input.colorways ?? []
  if (colorways.length === 0) {
    elements.push(
      makeElement(
        {
          type: "text",
          x: originX + FRAME.pad,
          y: FRAME.pad,
          width: 300,
          height: 24,
          text: "No colorways",
          fontSize: 18,
        },
        rng,
        frameId
      )
    )
    return { elements, files }
  }

  const chipW = 120
  const chipH = 120
  const colGap = 60

  colorways.forEach((colorway, i) => {
    const chipX = originX + FRAME.pad + i * (chipW + colGap)
    const chipY = FRAME.pad
    elements.push(
      makeElement(
        {
          type: "rectangle",
          x: chipX,
          y: chipY,
          width: chipW,
          height: chipH,
          backgroundColor: colorway.hex_code,
          fillStyle: "solid",
          strokeColor: "#1e1e1e",
        },
        rng,
        frameId
      )
    )
    const nameLines = [colorway.name, colorway.thread_ref && `Thread ${colorway.thread_ref}`].filter(
      Boolean
    ) as string[]
    elements.push(
      makeElement(
        {
          type: "text",
          x: chipX,
          y: chipY + chipH + 12,
          width: chipW,
          height: nameLines.length * 22,
          text: nameLines.join("\n"),
          fontSize: 14,
          lineHeight: 1.35,
        },
        rng,
        frameId
      )
    )
  })

  return { elements, files }
}

// ── Construction-detail glyphs (parametric, native Excalidraw lines) ─────────────
//
// Each renderer maps fabric-derived params to polylines in a local glyphW × glyphH box
// (origin top-left). We emit them as native `line` elements so the detail stays editable
// in Excalidraw — never a raster glyph. Geometry mirrors the batch-1 construction-symbol
// vocabulary (dart = wedge, pleats = periodic folds, gathers = length-ratio loops…).
// Unknown techniques fall back to a labelled box so the detail-object is never dropped.

type DetailPolyline = { points: [number, number][]; dashed?: boolean }
type DetailRenderer = (
  params: Record<string, number>,
  w: number,
  h: number
) => DetailPolyline[]

const clampInt = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(v)))

export const DETAIL_RENDERERS: Record<string, DetailRenderer> = {
  // Wedge converging to a point; centre fold dashed. `intake` (0..1) widens the base.
  dart: (p, w, h) => {
    const cx = w / 2
    const half = w * 0.28 * Math.max(0.2, Math.min(1, p.intake ?? 0.5))
    const apexY = h * 0.14
    const baseY = h * 0.9
    return [
      { points: [[cx - half, baseY], [cx, apexY]] },
      { points: [[cx + half, baseY], [cx, apexY]] },
      { points: [[cx - half, baseY], [cx + half, baseY]] },
      { points: [[cx, baseY], [cx, apexY]], dashed: true },
    ]
  },
  // Parallel one-direction folds + top fold-catches. `count` sets the fold count.
  "knife-pleat": (p, w, h) => {
    const n = clampInt(p.count ?? 4, 2, 7)
    const top = h * 0.12,
      bot = h * 0.9
    const x0 = w * 0.16,
      step = (w * 0.68) / (n - 1)
    const out: DetailPolyline[] = []
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step
      out.push({ points: [[x, top], [x, bot]] })
      out.push({ points: [[x - step * 0.5, top], [x, top]] })
    }
    return out
  },
  // Folds facing away from a centre line (a mirrored pair of knife pleats).
  "box-pleat": (_p, w, h) => {
    const cx = w / 2,
      d = w * 0.2
    const top = h * 0.12,
      bot = h * 0.9
    return [
      { points: [[cx, top], [cx, bot]] },
      { points: [[cx - d, top], [cx - d, bot]] },
      { points: [[cx + d, top], [cx + d, bot]] },
      { points: [[cx - d, top], [cx, top]] },
      { points: [[cx + d, top], [cx, top]] },
    ]
  },
  // Seam baseline with fabric ruched onto it. `ratio` (>1) sets the loop count.
  gathers: (p, w, h) => {
    const n = clampInt(3 + Math.max(1, p.ratio ?? 2) * 2, 5, 11)
    const y = h * 0.7,
      x0 = w * 0.1,
      x1 = w * 0.9,
      step = (x1 - x0) / n
    const out: DetailPolyline[] = [{ points: [[x0, y], [x1, y]] }]
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step
      out.push({
        points: [
          [x, y],
          [x + step * 0.25, y - h * 0.32],
          [x + step * 0.75, y - h * 0.32],
          [x + step, y],
        ],
      })
    }
    return out
  },
  // Parallel fold lines with catch ticks. `count` sets the tuck count.
  tucks: (p, w, h) => {
    const n = clampInt(p.count ?? 4, 2, 6)
    const top = h * 0.14,
      bot = h * 0.86
    const x0 = w * 0.2,
      step = (w * 0.6) / (n - 1)
    const out: DetailPolyline[] = []
    for (let i = 0; i < n; i++) {
      const x = x0 + i * step
      out.push({ points: [[x, top], [x, bot]] })
      out.push({ points: [[x, top], [x + w * 0.05, top]] })
      out.push({ points: [[x, bot], [x + w * 0.05, bot]] })
    }
    return out
  },
  // Edge line + parallel dashed stitch rows. `rows` sets the stitch-row count.
  topstitch: (p, w, h) => {
    const rows = clampInt(p.rows ?? 2, 1, 3)
    const x0 = w * 0.12,
      x1 = w * 0.88
    const out: DetailPolyline[] = [{ points: [[x0, h * 0.3], [x1, h * 0.3]] }]
    for (let i = 0; i < rows; i++) {
      const y = h * 0.42 + i * h * 0.14
      out.push({ points: [[x0, y], [x1, y]], dashed: true })
    }
    return out
  },
  // Shoulder panel with a dashed (curved) yoke seam. `drop` (0..1) lowers the seam.
  yoke: (p, w, h) => {
    const drop = Math.max(0.1, Math.min(1, p.drop ?? 0.5))
    const lx = w * 0.16,
      rx = w * 0.84
    const top = h * 0.18,
      bot = h * 0.9
    const seamY = h * 0.3 + h * 0.32 * drop
    const seam: [number, number][] = []
    const n = 8
    for (let i = 0; i <= n; i++) {
      const t = i / n
      seam.push([lx + (rx - lx) * t, seamY + Math.sin(t * Math.PI) * h * 0.08])
    }
    return [
      { points: [[lx, top], [rx, top], [rx, bot], [lx, bot], [lx, top]] },
      { points: seam, dashed: true },
    ]
  },
  // Dashed placement ring + a small radial motif. `motif` sets the petal count.
  embroidery: (p, w, h) => {
    const cx = w / 2,
      cy = h * 0.5,
      rx = w * 0.36,
      ry = h * 0.34
    const ring: [number, number][] = []
    const seg = 28
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      ring.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
    }
    const out: DetailPolyline[] = [{ points: ring, dashed: true }]
    const petals = clampInt(p.motif ?? 5, 3, 8)
    for (let i = 0; i < petals; i++) {
      const a = (i / petals) * Math.PI * 2
      out.push({
        points: [[cx, cy], [cx + Math.cos(a) * w * 0.09, cy + Math.sin(a) * h * 0.1]],
      })
    }
    return out
  },
}

/**
 * "4 · Construction details" — one glyph per detail, laid out in a grid. Each glyph is
 * a native, editable line-drawing derived from the detail's fabric-set params; the full
 * detail-object (technique + params + fabricRules) rides on the label element's
 * `customData` so downstream tooling can round-trip it. Mirrors buildColorwayFrame.
 */
export function buildConstructionDetailsFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  const frameId = rng.id("frame")
  const frame = makeElement(
    {
      type: "frame",
      id: frameId,
      x: originX,
      y: 0,
      width: FRAME.width,
      height: FRAME.height,
      name: "4 · Construction details",
    },
    rng
  )

  const elements: ExcalidrawElement[] = [frame]
  const files: Record<string, ExcalidrawFile> = {}

  const details = input.details ?? []
  if (details.length === 0) {
    elements.push(
      makeElement(
        {
          type: "text",
          x: originX + FRAME.pad,
          y: FRAME.pad,
          width: 300,
          height: 24,
          text: "No construction details",
          fontSize: 18,
        },
        rng,
        frameId
      )
    )
    return { elements, files }
  }

  const cols = 4
  const glyphW = 180
  const glyphH = 140
  const colGap = 60
  const cellW = glyphW + colGap
  const cellH = glyphH + 12 + 44 + 70 // glyph + gap + label band + row gap

  details.forEach((detail, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cellX = originX + FRAME.pad + col * cellW
    const cellY = FRAME.pad + row * cellH

    const renderer = DETAIL_RENDERERS[detail.technique]
    if (renderer) {
      for (const pl of renderer(detail.params ?? {}, glyphW, glyphH)) {
        const xs = pl.points.map((pt) => pt[0])
        const ys = pl.points.map((pt) => pt[1])
        const minX = Math.min(...xs)
        const minY = Math.min(...ys)
        elements.push(
          makeElement(
            {
              type: "line",
              x: cellX + minX,
              y: cellY + minY,
              width: Math.max(...xs) - minX,
              height: Math.max(...ys) - minY,
              points: pl.points.map(
                (pt) => [pt[0] - minX, pt[1] - minY] as [number, number]
              ),
              strokeColor: "#3f454c",
              strokeWidth: 2,
              strokeStyle: pl.dashed ? "dashed" : "solid",
              customData: {
                kind: "construction-glyph",
                technique: detail.technique,
              },
            },
            rng,
            frameId
          )
        )
      }
    } else {
      // Unknown technique — labelled placeholder box so the detail is never dropped.
      elements.push(
        makeElement(
          {
            type: "rectangle",
            x: cellX,
            y: cellY,
            width: glyphW,
            height: glyphH,
            strokeColor: "#c0c6cc",
            strokeStyle: "dashed",
          },
          rng,
          frameId
        )
      )
    }

    // Label = the detail-object anchor (carries the full construction detail).
    const labelLines = [detail.label, detail.note].filter(Boolean) as string[]
    elements.push(
      makeElement(
        {
          type: "text",
          x: cellX,
          y: cellY + glyphH + 12,
          width: glyphW,
          height: labelLines.length * 22,
          text: labelLines.join("\n"),
          fontSize: 14,
          lineHeight: 1.35,
          customData: {
            kind: "construction-detail",
            technique: detail.technique,
            label: detail.label,
            ...(detail.params ? { params: detail.params } : {}),
            ...(detail.fabricRules ? { fabricRules: detail.fabricRules } : {}),
          },
        },
        rng,
        frameId
      )
    )
  })

  return { elements, files }
}

// ── Brief anchor frames (#1113 S2) ────────────────────────────────────────────────
//
// The design brief is rendered as presentable cards — "here's the brief; here are the
// cards asking a designer to work." Value cards carry `customData` (kind:"brief-field")
// so an editable canvas can round-trip an edit back to the brief columns (S3+).

const PRICE_POINT_LABEL: Record<string, string> = {
  luxury: "Luxury",
  mid_market: "Mid-market",
  budget: "Budget",
}

/** A titled card: rounded rectangle background + bold heading + body text block. */
function pushBriefCard(
  elements: ExcalidrawElement[],
  rng: SceneRng,
  frameId: string,
  opts: {
    x: number
    y: number
    width: number
    height: number
    heading: string
    body: string
    accent?: string
    customData?: Record<string, unknown>
  }
): void {
  elements.push(
    makeElement(
      {
        type: "rectangle",
        x: opts.x,
        y: opts.y,
        width: opts.width,
        height: opts.height,
        backgroundColor: opts.accent ?? "#f5f5f4",
        fillStyle: "solid",
        strokeColor: "#d6d3d1",
        roundness: { type: 3 },
        ...(opts.customData ? { customData: opts.customData } : {}),
      },
      rng,
      frameId
    )
  )
  elements.push(
    makeElement(
      {
        type: "text",
        x: opts.x + 20,
        y: opts.y + 16,
        width: opts.width - 40,
        height: 22,
        text: opts.heading,
        fontSize: 16,
        fontFamily: 3,
      },
      rng,
      frameId
    )
  )
  elements.push(
    makeElement(
      {
        type: "text",
        x: opts.x + 20,
        y: opts.y + 46,
        width: opts.width - 40,
        height: opts.height - 62,
        text: opts.body || "—",
        fontSize: 14,
        lineHeight: 1.4,
      },
      rng,
      frameId
    )
  )
}

/** Frame title (the big label at the top of a brief frame). */
function pushFrameTitle(
  elements: ExcalidrawElement[],
  rng: SceneRng,
  frameId: string,
  originX: number,
  title: string
): void {
  elements.push(
    makeElement(
      {
        type: "text",
        x: originX + FRAME.pad,
        y: FRAME.pad,
        width: FRAME.width - FRAME.pad * 2,
        height: 34,
        text: title,
        fontSize: 28,
        fontFamily: 3,
      },
      rng,
      frameId
    )
  )
}

export function hasConceptSection(b?: TechPackBrief): boolean {
  return !!(b && (b.concept_theme || b.aesthetic_keywords?.length))
}
export function hasAudienceSection(b?: TechPackBrief): boolean {
  return !!(
    b &&
    (b.persona || b.competitors?.length || b.price_point)
  )
}
export function hasTimelineSection(b?: TechPackBrief): boolean {
  return !!(
    b &&
    (b.milestones?.length || b.design_budget != null || b.target_completion_date)
  )
}
export function briefHasContent(b?: TechPackBrief): boolean {
  return hasConceptSection(b) || hasAudienceSection(b) || hasTimelineSection(b)
}

/** Brief Frame 1 — Core Identity & Concept (concept/theme + aesthetic anchor). */
export function buildBriefConceptFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  const b = input.brief ?? {}
  const frameId = rng.id("frame")
  const frame = makeElement(
    { type: "frame", id: frameId, x: originX, y: 0, width: FRAME.width, height: FRAME.height, name: "Brief · Concept & Identity" },
    rng
  )
  const elements: ExcalidrawElement[] = [frame]
  pushFrameTitle(elements, rng, frameId, originX, "Concept & Identity")

  const cardY = FRAME.pad + 60
  pushBriefCard(elements, rng, frameId, {
    x: originX + FRAME.pad,
    y: cardY,
    width: 700,
    height: 220,
    heading: "Concept / Theme",
    body: b.concept_theme || "Set the overarching story or inspiration.",
    accent: "#eef2ff",
    customData: { kind: "brief-field", field: "concept_theme" },
  })

  // Aesthetic Anchor — keywords as pills.
  const keywords = (b.aesthetic_keywords ?? []).filter(Boolean)
  const anchorX = originX + FRAME.pad
  const anchorY = cardY + 260
  elements.push(
    makeElement(
      { type: "text", x: anchorX, y: anchorY, width: 700, height: 22, text: "Aesthetic Anchor", fontSize: 16, fontFamily: 3 },
      rng,
      frameId
    )
  )
  if (keywords.length) {
    let px = anchorX
    let py = anchorY + 34
    keywords.forEach((kw) => {
      const pillW = Math.max(90, kw.length * 11 + 32)
      if (px + pillW > anchorX + 700) {
        px = anchorX
        py += 54
      }
      elements.push(
        makeElement(
          { type: "rectangle", x: px, y: py, width: pillW, height: 40, backgroundColor: "#e0e7ff", fillStyle: "solid", strokeColor: "#a5b4fc", roundness: { type: 3 }, customData: { kind: "brief-field", field: "aesthetic_keywords" } },
          rng,
          frameId
        )
      )
      elements.push(
        makeElement(
          { type: "text", x: px + 16, y: py + 11, width: pillW - 32, height: 20, text: kw, fontSize: 15, textAlign: "center" },
          rng,
          frameId
        )
      )
      px += pillW + 16
    })
  } else {
    elements.push(
      makeElement(
        { type: "text", x: anchorX, y: anchorY + 34, width: 700, height: 20, text: "3–5 keywords that define the look & feel (e.g. utilitarian, sleek, nostalgic).", fontSize: 14, opacity: 60 },
        rng,
        frameId
      )
    )
  }

  return { elements, files: {} }
}

/** Brief Frame 2 — Target Audience & Market Positioning. */
export function buildBriefAudienceFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  const b = input.brief ?? {}
  const frameId = rng.id("frame")
  const frame = makeElement(
    { type: "frame", id: frameId, x: originX, y: 0, width: FRAME.width, height: FRAME.height, name: "Brief · Audience & Positioning" },
    rng
  )
  const elements: ExcalidrawElement[] = [frame]
  pushFrameTitle(elements, rng, frameId, originX, "Audience & Positioning")

  const cardY = FRAME.pad + 60

  // Persona card.
  const p = b.persona ?? {}
  const personaLines = [
    p.age_range && `Age  ${p.age_range}`,
    p.lifestyle && `Lifestyle  ${p.lifestyle}`,
    p.values?.length && `Values  ${p.values.join(", ")}`,
    p.pain_points?.length && `Pain points  ${p.pain_points.join(", ")}`,
  ].filter(Boolean) as string[]
  pushBriefCard(elements, rng, frameId, {
    x: originX + FRAME.pad,
    y: cardY,
    width: 540,
    height: 300,
    heading: "Persona",
    body: personaLines.length ? personaLines.join("\n") : "Who you're designing for.",
    accent: "#f0fdf4",
    customData: { kind: "brief-field", field: "persona" },
  })

  // Competitors card.
  const competitors = (b.competitors ?? []).filter((c) => c?.name)
  const compBody = competitors.length
    ? competitors
        .map((c) => `• ${c.name}${c.differentiator ? ` — ${c.differentiator}` : ""}`)
        .join("\n")
    : "Who else is in this space, and how this stands out."
  pushBriefCard(elements, rng, frameId, {
    x: originX + FRAME.pad + 580,
    y: cardY,
    width: 500,
    height: 300,
    heading: "Competitors",
    body: compBody,
    accent: "#fef2f2",
    customData: { kind: "brief-field", field: "competitors" },
  })

  // Price-point badge.
  const ppY = cardY + 330
  const ppLabel = b.price_point ? PRICE_POINT_LABEL[b.price_point] ?? b.price_point : null
  pushBriefCard(elements, rng, frameId, {
    x: originX + FRAME.pad,
    y: ppY,
    width: 320,
    height: 110,
    heading: "Price Point",
    body: ppLabel ?? "Luxury · Mid-market · Budget",
    accent: "#fefce8",
    customData: { kind: "brief-field", field: "price_point" },
  })

  return { elements, files: {} }
}

/** Brief Frame 3 — Timeline & Budget (milestones + design budget). */
export function buildBriefTimelineFrame(
  input: TechPackSceneInput,
  rng: SceneRng,
  originX: number
): FrameResult {
  const b = input.brief ?? {}
  const frameId = rng.id("frame")
  const frame = makeElement(
    { type: "frame", id: frameId, x: originX, y: 0, width: FRAME.width, height: FRAME.height, name: "Brief · Timeline & Budget" },
    rng
  )
  const elements: ExcalidrawElement[] = [frame]
  pushFrameTitle(elements, rng, frameId, originX, "Timeline & Budget")

  const cardY = FRAME.pad + 60

  // Milestones as a labelled timeline of rows.
  const milestones = (b.milestones ?? []).filter((m) => m?.label)
  const msBody = milestones.length
    ? milestones.map((m) => `• ${m.label}${m.date ? `  —  ${m.date}` : "  —  TBD"}`).join("\n")
    : "Initial sketches · First revisions · Final tech specs · Production-ready samples"
  pushBriefCard(elements, rng, frameId, {
    x: originX + FRAME.pad,
    y: cardY,
    width: 640,
    height: 360,
    heading: "Key Milestones",
    body: msBody,
    accent: "#eff6ff",
    customData: { kind: "brief-field", field: "milestones" },
  })

  // Design budget card.
  const budgetText =
    b.design_budget != null
      ? `${b.cost_currency ? b.cost_currency.toUpperCase() + " " : ""}${b.design_budget.toLocaleString("en-US")}`
      : "Total budget for the design phase (separate from manufacturing)."
  pushBriefCard(elements, rng, frameId, {
    x: originX + FRAME.pad + 680,
    y: cardY,
    width: 400,
    height: 170,
    heading: "Design Budget",
    body: budgetText,
    accent: "#f0fdfa",
    customData: { kind: "brief-field", field: "design_budget" },
  })

  // Hard deadline card.
  pushBriefCard(elements, rng, frameId, {
    x: originX + FRAME.pad + 680,
    y: cardY + 190,
    width: 400,
    height: 170,
    heading: "Target Completion",
    body: b.target_completion_date || "The single hard deadline.",
    accent: "#faf5ff",
    customData: { kind: "brief-field", field: "target_completion_date" },
  })

  return { elements, files: {} }
}

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
  ) => FrameResult)[] = []
  // Brief anchor frames come first — they are the "here's the brief" surface.
  if (hasConceptSection(input.brief)) builders.push(buildBriefConceptFrame)
  if (hasAudienceSection(input.brief)) builders.push(buildBriefAudienceFrame)
  if (hasTimelineSection(input.brief)) builders.push(buildBriefTimelineFrame)
  builders.push(buildHeaderFlatsFrame)
  if (input.sizeSet) builders.push(buildMeasurementFrame)
  if (input.regions?.length) builders.push(buildZoomLensFrame)
  if (input.details?.length) builders.push(buildConstructionDetailsFrame)
  if (input.colorways?.length) builders.push(buildColorwayFrame)

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
