/**
 * Draft FreeSewing pattern blocks into clean, Library-styled SVG cut pieces.
 *
 * FreeSewing (MIT, v4) drafts real measurement-true blocks but its own renderer
 * (plugin-theme) adds paper-pattern chrome — piece numbers, dates, a patron box,
 * and untranslated annotation keys. We skip it entirely: draft the block, then
 * extract the cut outline ourselves and emit an SVG matching the existing Fashion
 * Library aesthetic (slate stroke on cream, name + cut label).
 *
 * Outline extraction is design-specific:
 *  - "fill"  — the part exposes a single closed `seam` path (Bella, Titan) → one
 *              filled `<path>` (the cut piece).
 *  - "line"  — no `seam`; the outline is composed of several open segments +
 *              mirrored halves (Sarah) → stroke each as a `fill:none` line drawing.
 *
 * FreeSewing is ESM-only + untyped; loaded via dynamic `import()` because the
 * backend is CommonJS (same pattern as segment/route.ts with @fal-ai/client).
 */

import { resolveMeasurements, type MeasurementUnit } from "./measurements"

export type PatternBlockId = "bodice" | "skirt" | "trouser"

export interface PatternPieceSvg {
  /** FreeSewing part name, e.g. "bella.frontSideDart". */
  part: string
  /** Human label rendered on the piece, e.g. "Front Bodice". */
  label: string
  /** Standalone SVG string (base64-safe / btoa-safe ASCII). */
  svg: string
  width: number
  height: number
}

export interface DraftedBlock {
  id: PatternBlockId
  label: string
  pieces: PatternPieceSvg[]
}

export interface PatternBlockInfo {
  id: PatternBlockId
  label: string
  category: string
}

// ── Minimal shapes for the untyped FreeSewing objects we touch ──────────────
interface FsPath {
  hidden?: boolean
  asPathstring(): string
  bbox(): { topLeft: { x: number; y: number }; bottomRight: { x: number; y: number } }
}
interface FsPart {
  paths?: Record<string, FsPath>
}
interface FsPattern {
  draft(): unknown
  parts?: Array<Record<string, FsPart>>
}
type FsDesign = new (config: { measurements: Record<string, number> }) => FsPattern

interface BlockDef {
  id: PatternBlockId
  label: string
  category: string
  /** Dynamic-import the FreeSewing design class. */
  load: () => Promise<FsDesign>
  /** Friendly labels keyed by FreeSewing part name. */
  partLabels: Record<string, string>
}

const BLOCKS: BlockDef[] = [
  {
    id: "bodice",
    label: "Bodice Block",
    category: "bodice",
    load: async () => (await import("@freesewing/bella")).Bella as FsDesign,
    partLabels: { "bella.frontSideDart": "Front Bodice", "bella.back": "Back Bodice" },
  },
  {
    id: "skirt",
    label: "Skirt Block",
    category: "skirt",
    load: async () => (await import("@freesewing/sarah")).Sarah as FsDesign,
    partLabels: { "sarah.front": "Skirt Front", "sarah.back": "Skirt Back" },
  },
  {
    id: "trouser",
    label: "Trouser Block",
    category: "trouser",
    load: async () => (await import("@freesewing/titan")).Titan as FsDesign,
    partLabels: { "titan.front": "Trouser Front", "titan.back": "Trouser Back" },
  },
]

/** Public catalog for the API to enumerate available blocks. */
export const PATTERN_BLOCKS: PatternBlockInfo[] = BLOCKS.map(({ id, label, category }) => ({
  id,
  label,
  category,
}))

// ── Styling: matches the existing Fashion Library (fashion-croquis.ts) ──────
const CUT = `stroke="#90a0b0" stroke-width="3" fill="#fdfcf8" stroke-linejoin="round" stroke-linecap="round"`
const LINE = `stroke="#90a0b0" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"`
const DART = `stroke="#90a0b0" stroke-width="2" fill="none" stroke-linejoin="round"`
const GRAIN = `#8090a0`
const PAD = 26

const isMacro = (name: string) => name.startsWith("__macro")
const isHelper = (name: string) => /helper|hint|dimension|mark/i.test(name)
const isDart = (name: string) => /dart/i.test(name)

function outlinePaths(part: FsPart): { mode: "fill" | "line"; paths: FsPath[] } {
  const paths = part.paths ?? {}
  const seam = paths.seam
  if (seam && !seam.hidden) return { mode: "fill", paths: [seam] }
  const composed = Object.entries(paths)
    .filter(([n, p]) => p && !p.hidden && !isMacro(n) && !isHelper(n) && !isDart(n))
    .map(([, p]) => p)
  return { mode: "line", paths: composed }
}

function unionBox(paths: FsPath[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of paths) {
    try {
      const b = p.bbox()
      if (!b?.topLeft || !b?.bottomRight) continue
      minX = Math.min(minX, b.topLeft.x)
      minY = Math.min(minY, b.topLeft.y)
      maxX = Math.max(maxX, b.bottomRight.x)
      maxY = Math.max(maxY, b.bottomRight.y)
    } catch {
      // FreeSewing bbox() can throw on degenerate paths — skip
    }
  }
  return { minX, minY, maxX, maxY }
}

function renderPart(part: FsPart, label: string, cut: string): PatternPieceSvg | null {
  const { mode, paths } = outlinePaths(part)
  if (!paths.length) return null
  const { minX, minY, maxX, maxY } = unionBox(paths)
  if (!isFinite(minX) || maxX <= minX || maxY <= minY) return null

  const x = minX - PAD
  const y = minY - PAD
  const w = maxX - minX + PAD * 2
  const h = maxY - minY + PAD * 2
  const cx = minX + (maxX - minX) / 2
  const cy = minY + (maxY - minY) / 2

  const style = mode === "fill" ? CUT : LINE
  const parts: string[] = paths.map((p) => `<path ${style} d="${p.asPathstring()}"/>`)

  const dart = part.paths?.dart
  if (dart && !dart.hidden) parts.push(`<path ${DART} d="${dart.asPathstring()}"/>`)

  // grainline arrow through the centroid (vertical), ~70% of height
  const gy1 = minY + (maxY - minY) * 0.16
  const gy2 = maxY - (maxY - minY) * 0.16
  parts.push(
    `<line x1="${cx.toFixed(1)}" y1="${gy1.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${gy2.toFixed(1)}" stroke="${GRAIN}" stroke-width="1.5"/>` +
      `<polygon points="${cx.toFixed(1)},${(gy1 - 7).toFixed(1)} ${(cx - 5).toFixed(1)},${(gy1 + 4).toFixed(1)} ${(cx + 5).toFixed(1)},${(gy1 + 4).toFixed(1)}" fill="${GRAIN}"/>` +
      `<polygon points="${cx.toFixed(1)},${(gy2 + 7).toFixed(1)} ${(cx - 5).toFixed(1)},${(gy2 - 4).toFixed(1)} ${(cx + 5).toFixed(1)},${(gy2 - 4).toFixed(1)}" fill="${GRAIN}"/>`
  )

  parts.push(
    `<text x="${cx.toFixed(0)}" y="${(cy - 8).toFixed(0)}" font-size="26" fill="#8090a0" font-family="sans-serif" text-anchor="middle">${label}</text>`,
    `<text x="${cx.toFixed(0)}" y="${(cy + 22).toFixed(0)}" font-size="20" fill="#a0a8b0" font-family="sans-serif" text-anchor="middle">${cut}</text>`
  )

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}">` +
    parts.join("") +
    `</svg>`

  return { part: "", label, svg, width: Math.round(w), height: Math.round(h) }
}

function friendlyPartName(partName: string): string {
  const tail = partName.split(".").pop() ?? partName
  return tail.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
}

/**
 * Draft a single block from a full FreeSewing measurement set (mm).
 * Parts with no extractable outline (base/construction/empty parts) are skipped.
 */
export async function draftPatternBlock(
  id: PatternBlockId,
  measurementsMm: Record<string, number>
): Promise<DraftedBlock> {
  const def = BLOCKS.find((b) => b.id === id)
  if (!def) throw new Error(`Unknown pattern block: ${id}`)

  const Design = await def.load()
  const pattern = new Design({ measurements: measurementsMm })
  pattern.draft()

  const parts = pattern.parts?.[0] ?? {}
  const pieces: PatternPieceSvg[] = []
  for (const [partName, part] of Object.entries(parts)) {
    if (!part?.paths) continue
    const rendered = renderPart(part, def.partLabels[partName] ?? friendlyPartName(partName), def.label)
    if (rendered) pieces.push({ ...rendered, part: partName })
  }

  if (!pieces.length) throw new Error(`Block "${id}" drafted no renderable pieces`)
  return { id, label: def.label, pieces }
}

/**
 * Draft a block directly from a design size set (inches by default) — resolves
 * measurements (base model + overrides) then drafts.
 */
export async function draftPatternBlockFromSizeSet(
  id: PatternBlockId,
  sizeSetMeasurements: Record<string, number> | null | undefined,
  unit: MeasurementUnit = "in"
): Promise<DraftedBlock> {
  const measurementsMm = await resolveMeasurements(sizeSetMeasurements, unit)
  return draftPatternBlock(id, measurementsMm)
}
