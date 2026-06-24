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
