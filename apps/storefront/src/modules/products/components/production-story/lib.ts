/**
 * Pure, IO-free helpers for the "How this was made" production-story render.
 *
 * Kept separate from the async server component so the formatting logic is
 * unit-testable in isolation (vitest, node env). No money/cost logic here —
 * the backend story is deliberately money-free and so is this.
 */

import type { ProductionStory } from "@lib/data/designs"

/**
 * Humanize an enum-ish string: "in_progress" → "In Progress".
 * Mirrors DesignInfo's task-label formatter (replace [-_] then title-case).
 */
export function humanizeStatus(value: string | null | undefined): string {
  if (!value) return ""
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

/**
 * Normalize whatever is stored in a raw material's `media` json into a clean,
 * de-duped list of url strings. Mirrors the backend's
 * `normalizeMediaFiles` (src/workflows/media/lib/media-binding.ts) so the same
 * historical shapes render correctly here:
 *   - `{ files: string[] }`            (canonical — form + bulk-import)
 *   - `string[]`                       (older rows)
 *   - `{ files: { url|file_path }[] }` (object entries)
 *   - `null` / malformed               → `[]`
 */
export function normalizeMediaUrls(media: unknown): string[] {
  if (!media) return []
  let arr: unknown[] = []
  if (Array.isArray(media)) {
    arr = media
  } else if (
    typeof media === "object" &&
    Array.isArray((media as { files?: unknown }).files)
  ) {
    arr = (media as { files: unknown[] }).files
  } else {
    return []
  }

  const urls = arr
    .map((entry) => {
      if (typeof entry === "string") return entry
      if (entry && typeof entry === "object") {
        const obj = entry as { url?: unknown; file_path?: unknown }
        const candidate = obj.url ?? obj.file_path
        return typeof candidate === "string" ? candidate : null
      }
      return null
    })
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0)

  return Array.from(new Set(urls))
}

/** First derivable media url for a raw material, or null. */
export function pickFirstMediaUrl(media: unknown): string | null {
  return normalizeMediaUrls(media)[0] ?? null
}

/**
 * Whether the story has nothing worth showing. Mirrors the backend's
 * EMPTY_PRODUCTION_STORY: no runs AND no people AND no materials AND no
 * partners AND zero consumption. When true the section renders nothing so
 * products without production data are unaffected.
 */
export function isStoryEmpty(story: ProductionStory | null | undefined): boolean {
  if (!story) return true
  const { runs, people, materials, partners, consumption } = story
  const hasRuns = (runs?.length ?? 0) > 0
  const hasPeople = (people?.length ?? 0) > 0
  const hasMaterials = (materials?.length ?? 0) > 0
  const hasPartners = (partners?.length ?? 0) > 0
  const energy = consumption?.energy
  const hasConsumption =
    (consumption?.total_logs ?? 0) > 0 ||
    (consumption?.labor_hours ?? 0) > 0 ||
    (energy?.electricity_kwh ?? 0) > 0 ||
    (energy?.water_liters ?? 0) > 0 ||
    (energy?.gas_cubic_meters ?? 0) > 0 ||
    (consumption?.materials_consumed?.length ?? 0) > 0

  return !hasRuns && !hasPeople && !hasMaterials && !hasPartners && !hasConsumption
}

/**
 * Build the list of non-zero energy/labor metrics worth rendering. Only
 * non-zero values are returned so the sustainability block stays honest.
 */
export function nonZeroConsumptionMetrics(
  story: ProductionStory | null | undefined
): { label: string; value: string }[] {
  const c = story?.consumption
  if (!c) return []
  const e = c.energy
  const metrics: { label: string; value: string }[] = []

  const push = (label: string, value: number | null | undefined, unit: string) => {
    if (typeof value === "number" && value > 0) {
      metrics.push({ label, value: `${formatNumber(value)} ${unit}` })
    }
  }

  push("Electricity", e?.electricity_kwh, "kWh")
  push("Water", e?.water_liters, "L")
  push("Gas", e?.gas_cubic_meters, "m³")
  push("Labor", c.labor_hours, c.labor_hours === 1 ? "hour" : "hours")

  return metrics
}

/**
 * The environmental cost of one piece, as the product page shows it: only the
 * measured, non-zero lines. `measured: false` means the page says "not yet
 * measured" instead of drawing zeros.
 */
export function impactPerPiece(story: ProductionStory | null | undefined): {
  measured: boolean
  piecesMade: number
  metrics: { label: string; value: string }[]
} {
  const impact = story?.impact
  const e = impact?.per_piece
  const metrics: { label: string; value: string }[] = []
  const push = (label: string, value: number | null | undefined, unit: string) => {
    if (typeof value === "number" && value > 0) {
      metrics.push({ label, value: `${formatNumber(value)} ${unit}` })
    }
  }
  push("Electricity", e?.electricity_kwh, "kWh")
  push("Water", e?.water_liters, "L")
  push("Gas", e?.gas_cubic_meters, "m³")
  return {
    measured: Boolean(impact?.measured) && metrics.length > 0,
    piecesMade: impact?.pieces_made ?? 0,
    metrics,
  }
}

/** Trim trailing-zero decimals: 12.0 → "12", 12.5 → "12.5". */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0"
  return Number(value.toFixed(2)).toString()
}

export type JourneyStep = {
  id: string
  label: string
  date: string | null
  done: boolean
}

export type ProductionJourney = {
  steps: JourneyStep[]
  stepCount: number
  endDate: string | null
  completed: boolean
}

/**
 * Consolidate a design's production runs into ONE clean activity timeline.
 *
 * Runs come back as a PARENT + one CHILD per partner assignment (same
 * design_id). We don't surface that split or any run IDs — just the lifecycle
 * activities, merged across runs, de-duped by label+date, sorted chronologically
 * (ISO timestamps sort lexically).
 */
export function summarizeProductionJourney(
  runs: ProductionStory["runs"] | null | undefined
): ProductionJourney | null {
  if (!runs || runs.length === 0) return null

  const seen = new Set<string>()
  const steps: JourneyStep[] = []
  for (const run of runs) {
    for (const a of run.activity ?? []) {
      const label = (a.summary || humanizeStatus(a.activity_type)).trim()
      if (!label) continue
      const key = `${label.toLowerCase()}__${a.created_at ?? ""}`
      if (seen.has(key)) continue
      seen.add(key)
      steps.push({
        id: a.id,
        label,
        date: a.created_at ?? null,
        done: a.kind === "completed" || a.kind === "done",
      })
    }
  }

  steps.sort((x, y) => (x.date ?? "").localeCompare(y.date ?? ""))

  const endDate =
    pickLatestDate(runs.map((r) => r.completed_at)) ??
    pickLatestDate(runs.map((r) => r.finished_at)) ??
    pickLatestDate(runs.map((r) => r.created_at))

  return {
    steps,
    stepCount: steps.length,
    endDate,
    completed: runs.some((r) => r.status === "completed"),
  }
}

/** Latest of a set of ISO date strings (lexical sort), or null. */
export function pickLatestDate(
  values: (string | null | undefined)[]
): string | null {
  const valid = values.filter((v): v is string => !!v).sort()
  return valid.length ? valid[valid.length - 1] : null
}

/** Short date like "Mar 5, 2026", or null when unparseable. */
export function formatStoryDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * The public timeline: the first and the last step, the rest counted. The
 * backend already sends only this (`story.journey`); this condenses a full
 * list too, so a page served by an older backend still shows no more.
 */
export function condenseJourney(steps: JourneyStep[]): {
  steps: JourneyStep[]
  hiddenSteps: number
} {
  if (steps.length <= 2) return { steps, hiddenSteps: 0 }
  return {
    steps: [steps[0], steps[steps.length - 1]],
    hiddenSteps: steps.length - 2,
  }
}

/** The teaser timeline for a product page, from the public story. */
export function publicTimeline(
  story: ProductionStory | null | undefined
): { steps: JourneyStep[]; hiddenSteps: number } {
  if (story?.journey) {
    return {
      steps: story.journey.steps.map((s) => ({
        ...s,
        done: s.label === "Completed",
      })),
      hiddenSteps: story.journey.hidden_steps,
    }
  }
  return condenseJourney(summarizeProductionJourney(story?.runs)?.steps ?? [])
}

/** How a shopper reads each production stage: "Stitched by Sharlho". */
const STAGE_VERBS: Record<string, string> = {
  supplier: "Fabric from",
  weaving: "Woven by",
  dyeing: "Dyed by",
  printing: "Printed by",
  embroidery: "Embroidered by",
  cutting: "Cut by",
  stitching: "Stitched by",
  finishing: "Finished by",
  sampling: "Sampled by",
}
/** Stages that are not making the piece; never shown as a maker. */
const NOT_MAKING = new Set(["photoshoot"])

export type CraftedBy = {
  /** "Organic Kala Cotton — Earthy Tones", and who supplied it when known */
  fabrics: { id: string; name: string; supplier: string | null }[]
  /** "Stitched by" + "Sharlho", in roster order */
  makers: { id: string; verb: string; name: string }[]
}

/**
 * Who made the piece and what it is made from, in plain words (#2442).
 *
 * A fabric's supplier comes from the purchase order that bought it (backend).
 * A roster partner tagged `supplier` names the fabric only when no order did,
 * and is otherwise not repeated as a maker. Unknown stages read "Made by".
 */
export function craftedBy(
  story: ProductionStory | null | undefined,
  fallbackPartners: { id?: string; name?: string | null }[] = []
): CraftedBy {
  // Two raw-material rows can carry one fabric's name (a re-entered colour,
  // a second batch): the shopper reads it once.
  const fabrics: CraftedBy["fabrics"] = []
  const fabricKeys = new Set<string>()
  for (const m of story?.materials ?? []) {
    const name = m.name?.trim()
    if (!name) continue
    const supplier = m.supplier?.name?.trim() || null
    const key = `${name.toLowerCase()}::${supplier ?? ""}`
    if (fabricKeys.has(key)) continue
    fabricKeys.add(key)
    fabrics.push({ id: m.id, name, supplier })
  }

  const roster =
    story?.partners && story.partners.length > 0
      ? story.partners
      : fallbackPartners.map((p) => ({ id: p.id ?? "", name: p.name ?? null, stage_role: null }))

  const knownSuppliers = new Set(fabrics.map((f) => f.supplier).filter(Boolean))
  const makers: CraftedBy["makers"] = []
  const seen = new Set<string>()
  for (const p of roster) {
    const name = p.name?.trim()
    const stage = p.stage_role ?? null
    if (!name || (stage && NOT_MAKING.has(stage))) continue
    if (stage === "supplier") {
      // Named on the fabric already, or lend the name to fabrics with none.
      if (knownSuppliers.has(name)) continue
      if (fabrics.some((f) => !f.supplier)) {
        for (const f of fabrics) if (!f.supplier) f.supplier = name
        knownSuppliers.add(name)
        continue
      }
    }
    const verb = (stage && STAGE_VERBS[stage]) || "Made by"
    const key = `${verb}::${name}`
    if (seen.has(key)) continue
    seen.add(key)
    makers.push({ id: p.id, verb, name })
  }

  return { fabrics, makers }
}

/** "a@b.co" yes, "a@b", "" and "a b@c.d" no. Server checks again. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}
