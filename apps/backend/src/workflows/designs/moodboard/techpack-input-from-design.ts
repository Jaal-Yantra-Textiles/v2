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
  TechPackBrief,
  TechPackColorway,
  TechPackDetail,
  TechPackFlats,
  TechPackHeader,
  TechPackMaterial,
  TechPackSceneInput,
  TechPackSizeSet,
  TechPackSpec,
} from "./build-moodboard-scene"

/** The subset of a design graph this mapper reads. All fields optional/defensive. */
export interface DesignForTechPack {
  name?: string | null
  design_type?: string | null
  metadata?: Record<string, any> | null
  thumbnail_url?: string | null
  color_palette?: unknown
  // Brief columns (#604 / #1113 S2) — the anchor frames.
  concept_theme?: string | null
  aesthetic_keywords?: unknown
  persona?: Record<string, any> | null
  competitors?: unknown
  price_point?: string | null
  design_budget?: number | string | null
  cost_currency?: string | null
  milestones?: unknown
  target_completion_date?: string | Date | null
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
  /**
   * Pinned raw-material groups (#1113 Materials frame). Attached by the moodboard
   * loader via the design↔raw_material_group link, NOT a direct design column.
   */
  materials?: Array<{
    name?: string | null
    composition?: string | null
    status?: string | null
    colors?: string[] | null
    note?: string | null
  }> | null
}

/** The design-graph fields buildBriefInputFromDesign needs (for query.graph). */
export const DESIGN_BRIEF_GRAPH_FIELDS = [
  "concept_theme",
  "aesthetic_keywords",
  "persona",
  "competitors",
  "price_point",
  "design_budget",
  "cost_currency",
  "milestones",
  "target_completion_date",
] as const

/** Map a design's brief columns → the moodboard brief input. Pure + defensive. */
export function buildBriefInputFromDesign(
  design: DesignForTechPack
): TechPackBrief {
  const keywords = Array.isArray(design.aesthetic_keywords)
    ? (design.aesthetic_keywords as unknown[]).map(String).filter(Boolean)
    : null
  const competitors = Array.isArray(design.competitors)
    ? (design.competitors as any[])
        .filter((c) => c && c.name)
        .map((c) => ({
          name: String(c.name),
          ...(c.url ? { url: String(c.url) } : {}),
          ...(c.differentiator ? { differentiator: String(c.differentiator) } : {}),
        }))
    : null
  const milestones = Array.isArray(design.milestones)
    ? (design.milestones as any[])
        .filter((m) => m && m.label)
        .map((m) => ({ label: String(m.label), date: m.date ?? null }))
    : null
  const price = design.price_point
  return {
    concept_theme: design.concept_theme ?? null,
    aesthetic_keywords: keywords,
    persona: (design.persona as TechPackBrief["persona"]) ?? null,
    competitors,
    price_point:
      price === "luxury" || price === "mid_market" || price === "budget"
        ? price
        : null,
    milestones,
    design_budget:
      design.design_budget == null ? null : Number(design.design_budget),
    cost_currency: design.cost_currency ?? null,
    target_completion_date: design.target_completion_date
      ? new Date(design.target_completion_date).toISOString().slice(0, 10)
      : null,
  }
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

/** Every specification → a TechPackSpec card for the "Design Specs" frame (#1113). */
function normalizeSpecs(
  specs: DesignForTechPack["specifications"]
): TechPackSpec[] {
  return (specs ?? [])
    .filter((s) => s?.title)
    .map((s) => ({
      title: String(s.title),
      ...(s.category ? { category: String(s.category) } : {}),
      ...(s.details ? { details: String(s.details) } : {}),
      ...(s.special_instructions
        ? { special_instructions: String(s.special_instructions) }
        : {}),
    }))
}

/** Pinned material groups → TechPackMaterial cards for the "Materials" frame (#1113). */
function normalizeMaterials(
  materials: DesignForTechPack["materials"]
): TechPackMaterial[] {
  return (materials ?? [])
    .filter((m) => m?.name)
    .map((m) => ({
      name: String(m.name),
      ...(m.composition ? { composition: String(m.composition) } : {}),
      ...(m.status ? { status: String(m.status) } : {}),
      ...(Array.isArray(m.colors) && m.colors.length
        ? { colors: m.colors.map(String).filter(Boolean) }
        : {}),
      ...(m.note ? { note: String(m.note) } : {}),
    }))
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

/** Result of a completeness check: whether a design can generate a real tech-pack. */
export interface TechPackCompleteness {
  ok: boolean
  /** Human-readable descriptions of the required sections that are absent. */
  missing: string[]
}

/**
 * Gates generation: a design yields a meaningful tech-pack only when it carries the
 * substance of one — measurements (a size set) AND at least one construction detail
 * (a Construction spec that keys a technique). Colorways/flats are recommended but not
 * required. Runs on the already-mapped input, so `details` here has already dropped any
 * Construction specs that declared no technique. (#892)
 */
export function assessTechPackCompleteness(
  input: TechPackSceneInput
): TechPackCompleteness {
  const missing: string[] = []
  if (!input.sizeSet) {
    missing.push("a size set (for the measurements page)")
  }
  if (!input.details?.length) {
    missing.push(
      "at least one Construction specification with a technique (for the construction-details page)"
    )
  }
  return { ok: missing.length === 0, missing }
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

  const brief = buildBriefInputFromDesign(design)
  const specs = normalizeSpecs(design.specifications)
  const materials = normalizeMaterials(design.materials)

  return {
    design: header,
    garment_type,
    flats,
    brief,
    ...(sizeSet ? { sizeSet } : {}),
    ...(colorways.length ? { colorways } : {}),
    ...(details.length ? { details } : {}),
    ...(specs.length ? { specs } : {}),
    ...(materials.length ? { materials } : {}),
  }
}
