/**
 * techpack-input-from-design.ts — maps a design's structured data (as returned by
 * query.graph) into the `TechPackSceneInput` consumed by build-moodboard-scene.ts.
 *
 * This is the "real details source" that connects persisted design data to the pure
 * scene builder. It is itself pure and defensive (no DI, no throws on missing data):
 * every section is optional, so a sparse design still yields a valid one-frame scene.
 *
 * Where each section comes from:
 *  - header      → design.name + optional header hints on design.metadata
 *  - garment     → metadata.garment_type ?? design_type ?? "garment"
 *  - flats       → metadata.flats {front,back} ?? thumbnail_url (front fallback)
 *  - sizeSet     → first size_set (measurements are authoritative; unit via metadata)
 *  - colorways   → color_palette JSON (normalized from a few common shapes)
 *  - details     → specifications with category "Construction"; the renderable
 *                  { technique, params, fabricRules } live on each spec's metadata.
 */

import type {
  TechPackColorway,
  TechPackDetail,
  TechPackFlats,
  TechPackHeader,
  TechPackSceneInput,
  TechPackSizeSet,
} from "./build-moodboard-scene"

/** The subset of a design graph this mapper reads. All fields optional/defensive. */
export interface DesignForTechPack {
  name?: string | null
  design_type?: string | null
  metadata?: Record<string, any> | null
  thumbnail_url?: string | null
  color_palette?: unknown
  size_sets?: Array<{
    size_label?: string | null
    measurements?: Record<string, number> | null
  }> | null
  specifications?: Array<{
    title?: string | null
    category?: string | null
    details?: string | null
    special_instructions?: string | null
    metadata?: Record<string, any> | null
  }> | null
}

/** Normalize color_palette (several historical shapes) into TechPackColorway[]. */
function normalizeColorways(cp: unknown): TechPackColorway[] {
  if (!Array.isArray(cp)) return []
  return cp
    .map((c: any): TechPackColorway | null => {
      const hex = c?.hex_code ?? c?.hex ?? c?.color ?? c?.value
      if (!hex) return null
      return {
        name: c?.name ?? c?.label ?? "Colour",
        hex_code: String(hex),
        ...(c?.thread_ref ? { thread_ref: String(c.thread_ref) } : {}),
      }
    })
    .filter((c): c is TechPackColorway => c !== null)
}

/** A Construction spec → a TechPackDetail, or null if it declares no technique. */
function specToDetail(
  s: NonNullable<DesignForTechPack["specifications"]>[number]
): TechPackDetail | null {
  const m = s.metadata ?? {}
  const technique = m.technique ?? m.construction_technique
  // A detail must key a renderer (or at least a stable technique slug); specs without
  // one are skipped rather than rendered as anonymous placeholders.
  if (!technique) return null
  const note = s.special_instructions ?? s.details ?? undefined
  return {
    technique: String(technique),
    label: s.title ?? String(technique),
    ...(m.params && typeof m.params === "object" ? { params: m.params } : {}),
    ...(Array.isArray(m.fabricRules) ? { fabricRules: m.fabricRules.map(String) } : {}),
    ...(note ? { note: String(note) } : {}),
  }
}

export function buildTechPackInputFromDesign(
  design: DesignForTechPack
): TechPackSceneInput {
  const md = design.metadata ?? {}

  const header: TechPackHeader = {
    title: design.name ?? "Untitled design",
    ...(md.style_code ? { style_code: String(md.style_code) } : {}),
    ...(md.season ? { season: String(md.season) } : {}),
    ...(md.category ? { category: String(md.category) } : {}),
    ...(md.capsule ? { capsule: String(md.capsule) } : {}),
  }

  const garment_type = String(md.garment_type ?? design.design_type ?? "garment")

  const mdFlats = (md.flats ?? {}) as Record<string, any>
  const flats: TechPackFlats = {}
  const front = mdFlats.front_image_url ?? design.thumbnail_url
  if (front) flats.front_image_url = String(front)
  if (mdFlats.back_image_url) flats.back_image_url = String(mdFlats.back_image_url)

  let sizeSet: TechPackSizeSet | undefined
  const ss = design.size_sets?.[0]
  if (ss?.measurements && Object.keys(ss.measurements).length > 0) {
    sizeSet = {
      size_label: ss.size_label ?? "—",
      measurements: ss.measurements,
      unit: md.measurement_unit === "in" ? "in" : "cm",
    }
  }

  const colorways = normalizeColorways(design.color_palette)

  const details = (design.specifications ?? [])
    .filter((s) => s?.category === "Construction")
    .map(specToDetail)
    .filter((d): d is TechPackDetail => d !== null)

  return {
    design: header,
    garment_type,
    flats,
    ...(sizeSet ? { sizeSet } : {}),
    ...(colorways.length ? { colorways } : {}),
    ...(details.length ? { details } : {}),
  }
}
