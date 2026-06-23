/**
 * Pure helpers for the marketing read routes (#659 slice 3 PR-3c).
 *
 * Kept free of Medusa/HTTP imports so the query-parsing, latest-per-metric,
 * headline-blob and staleness math are unit-testable without booting the app.
 * The routes (`snapshots/route.ts`, `headline/route.ts`) are thin I/O over
 * the `marketing` module service; all shaping lives here.
 *
 * Field names track the SHIPPED slice-1 model (`value`, `captured_for_date`,
 * `delta_dod`) — NOT the stale spec names (`metric_value`/`as_of_date`/`wow_delta`).
 * The response still exposes `as_of_date`/`dod_delta` aliases for the UI contract.
 */

/**
 * The One-Goal hook (spec §1). Until the operator picks the One Goal, the
 * headline number defaults to platform net GMV. This is the ONLY place the
 * still-open product decision changes shipped behaviour; flipping the constant
 * (or sourcing it from config) is the whole change when the goal is chosen.
 */
export const HEADLINE_METRIC_KEY = "platform_net_gmv"

/** A snapshot row is considered stale once its business day is this many days behind "now". */
export const HEADLINE_STALE_AFTER_DAYS = 3

/** Default/cap for the `/snapshots` page size and the headline scan window. */
export const DEFAULT_SNAPSHOTS_LIMIT = 100
export const MAX_SNAPSHOTS_LIMIT = 500
/** How many recent rows the headline route scans to derive the strip + trend. */
export const HEADLINE_SCAN_TAKE = 200

const DAY_MS = 24 * 60 * 60 * 1000

export type SnapshotRow = {
  metric_key: string
  value: number
  unit?: string | null
  captured_for_date: Date | string
  source?: string | null
  breakdown?: unknown
  delta_dod?: number | null
}

export type SnapshotQuery = {
  metric_key?: string
  startDate?: Date
  endDate?: Date
  limit: number
  offset: number
}

export type HeadlineMetric = {
  metric_key: string
  value: number
  unit: string | null
  dod_delta: number | null
  as_of_date: string | null
}

export type HeadlineResponse = {
  headline: HeadlineMetric | null
  strip: HeadlineMetric[]
  trend: { as_of_date: string; value: number }[]
  stale: boolean
  generated_at: string
}

function firstOf(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined
  return Array.isArray(raw) ? String(raw[0]) : String(raw)
}

/** Parse a non-negative int, returning `fallback` on missing/invalid input. */
export function parseNonNegativeInt(raw: unknown, fallback: number): number {
  const s = firstOf(raw)
  if (s === undefined) return fallback
  const n = parseInt(s, 10)
  return Number.isNaN(n) || n < 0 ? fallback : n
}

/** Coerce a snapshot's captured_for_date (Date | ISO string) to epoch ms. */
export function snapshotEpoch(row: SnapshotRow): number {
  const d = row.captured_for_date
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  return Number.isNaN(t) ? 0 : t
}

function asIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString()
}

/**
 * Parse the `/admin/marketing/snapshots` query string into a normalised filter.
 * Mirrors the breakdown route param shape: `metric_key` equality, a `days`
 * rolling window (takes precedence) or explicit `start_date`/`end_date`,
 * plus `limit`/`offset` pagination (limit capped at MAX_SNAPSHOTS_LIMIT).
 */
export function parseSnapshotQuery(
  query: Record<string, unknown>,
  now: Date = new Date()
): SnapshotQuery {
  const metric_key = firstOf(query.metric_key)

  let startDate: Date | undefined
  let endDate: Date | undefined
  const daysRaw = firstOf(query.days)
  if (daysRaw !== undefined) {
    const days = parseInt(daysRaw, 10)
    if (!Number.isNaN(days) && days > 0) {
      startDate = new Date(now.getTime() - days * DAY_MS)
      endDate = now
    }
  } else {
    const sd = firstOf(query.start_date)
    const ed = firstOf(query.end_date)
    if (sd) {
      const d = new Date(sd)
      if (!Number.isNaN(d.getTime())) startDate = d
    }
    if (ed) {
      const d = new Date(ed)
      if (!Number.isNaN(d.getTime())) endDate = d
    }
  }

  const limit = Math.min(
    parseNonNegativeInt(query.limit, DEFAULT_SNAPSHOTS_LIMIT) || DEFAULT_SNAPSHOTS_LIMIT,
    MAX_SNAPSHOTS_LIMIT
  )
  const offset = parseNonNegativeInt(query.offset, 0)

  return { metric_key, startDate, endDate, limit, offset }
}

/** Newest-first by captured_for_date (stable for equal timestamps). */
export function sortSnapshotsNewestFirst(rows: SnapshotRow[]): SnapshotRow[] {
  return [...rows].sort((a, b) => snapshotEpoch(b) - snapshotEpoch(a))
}

/**
 * Reduce rows to the single newest row per metric_key. Input need not be sorted.
 */
export function latestPerMetricKey(rows: SnapshotRow[]): Map<string, SnapshotRow> {
  const latest = new Map<string, SnapshotRow>()
  for (const row of rows) {
    const cur = latest.get(row.metric_key)
    if (!cur || snapshotEpoch(row) > snapshotEpoch(cur)) {
      latest.set(row.metric_key, row)
    }
  }
  return latest
}

function toHeadlineMetric(row: SnapshotRow): HeadlineMetric {
  return {
    metric_key: row.metric_key,
    value: row.value,
    unit: row.unit ?? null,
    dod_delta: row.delta_dod ?? null,
    as_of_date: asIso(row.captured_for_date),
  }
}

/**
 * Build the SWR headline blob from already-fetched recent snapshot rows.
 *
 * - `headline` = newest row for `metricKey` (null if none yet → UI shows empty
 *   state, never a 500).
 * - `strip` = newest row for every OTHER metric_key (the secondary KPI cards),
 *   ordered by metric_key for stable rendering.
 * - `trend` = the `metricKey` series oldest→newest (for the sparkline).
 * - `stale` = true when the freshest headline business day is more than
 *   HEADLINE_STALE_AFTER_DAYS behind `now` (the cron likely missed a run), or
 *   when there is no data at all.
 */
export function buildHeadlineResponse(
  rows: SnapshotRow[],
  metricKey: string,
  now: Date = new Date()
): HeadlineResponse {
  const latest = latestPerMetricKey(rows)
  const headlineRow = latest.get(metricKey) ?? null

  const strip = [...latest.entries()]
    .filter(([key]) => key !== metricKey)
    .map(([, row]) => toHeadlineMetric(row))
    .sort((a, b) => a.metric_key.localeCompare(b.metric_key))

  const trend = sortSnapshotsNewestFirst(
    rows.filter((r) => r.metric_key === metricKey)
  )
    .reverse() // oldest → newest for the sparkline
    .map((r) => ({ as_of_date: asIso(r.captured_for_date), value: r.value }))

  let stale = true
  if (headlineRow) {
    const ageMs = now.getTime() - snapshotEpoch(headlineRow)
    stale = ageMs > HEADLINE_STALE_AFTER_DAYS * DAY_MS
  }

  return {
    headline: headlineRow ? toHeadlineMetric(headlineRow) : null,
    strip,
    trend,
    stale,
    generated_at: now.toISOString(),
  }
}
