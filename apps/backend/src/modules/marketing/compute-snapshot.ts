/**
 * compute-snapshot.ts — PURE metric-row math for the marketing daily-refresh job
 * (#659 slice 3, PR-3a).
 *
 * This file contains NO I/O and NO Medusa container access. The cron entry
 * (`marketing-daily-refresh.ts`, PR-3b) gathers raw inputs from Query / the
 * analytics rollup and the prior snapshot rows, then calls `computeSnapshotRows`
 * to shape the append-only `marketing_metric_snapshot` rows (model defined in
 * slice 1). Keeping the math pure makes it unit-testable without booting Medusa
 * (mirrors `analytics/compute-daily-stats.ts`).
 *
 * Field names align to the SHIPPED slice-1 model
 * (`models/marketing-metric-snapshot.ts`): `value` / `captured_for_date` /
 * `delta_dod` — NOT the stale spec names (`metric_value`/`as_of_date`/`dod_delta`).
 * The model has no week-over-week column, so this slice computes day-over-day only.
 */

/** A single metric the job measured for the business day (pre-delta, pre-persist). */
export type MarketingMetricInput = {
  metric_key: string
  value: number
  unit?: string | null
  /** optional drill-down rows for the snapshot's `breakdown` json column */
  breakdown?: Array<{ label: string; value: number }> | null
}

/** A prior `marketing_metric_snapshot` row, as read back for delta math. */
export type PriorSnapshotRow = {
  metric_key: string
  value: number
  captured_for_date: Date | string
}

/** Shape ready to hand to `createMarketingMetricSnapshots` (slice-1 service). */
export type ComputedSnapshotRow = {
  metric_key: string
  value: number
  unit: string | null
  captured_for_date: Date
  source: string
  breakdown: Array<{ label: string; value: number }> | null
  delta_dod: number | null
}

const IST_OFFSET_MIN = 5 * 60 + 30 // UTC+05:30 — JYT business timezone (report §7)

/**
 * The UTC instant corresponding to IST midnight of the IST calendar day that
 * contains `instant`. Cron fires in server TZ (UTC in prod), so the business day
 * must be derived explicitly — never trust local `new Date()` TZ (platform memory:
 * "cron is server-TZ"). Pure + deterministic for a given input.
 */
export function istDayStart(instant: Date): Date {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MIN * 60_000)
  const istMidnightUtcMs =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
    IST_OFFSET_MIN * 60_000
  return new Date(istMidnightUtcMs)
}

function toMs(d: Date | string): number {
  return (d instanceof Date ? d : new Date(d)).getTime()
}

/**
 * The most-recent prior snapshot value for a metric strictly BEFORE `asOfMs`.
 * Tolerates gaps (a skipped cron day) by picking the latest available prior row
 * rather than assuming exactly yesterday. Returns null when there is no history.
 */
export function priorValueFor(
  metricKey: string,
  asOfMs: number,
  priorRows: PriorSnapshotRow[] | null | undefined
): number | null {
  if (!priorRows || priorRows.length === 0) return null
  let bestMs = -Infinity
  let bestValue: number | null = null
  for (const row of priorRows) {
    if (row.metric_key !== metricKey) continue
    const ms = toMs(row.captured_for_date)
    if (ms >= asOfMs) continue // same day or future → not "prior"
    if (ms > bestMs) {
      bestMs = ms
      bestValue = row.value
    }
  }
  return bestValue
}

export type ComputeSnapshotOptions = {
  /** provenance stamp for the rows; defaults to "daily-refresh" */
  source?: string
}

/**
 * Shape append-only snapshot rows from the day's measured inputs + prior history.
 *
 * - `captured_for_date` is normalised to IST midnight so the slice-1 unique index
 *   `(metric_key, captured_for_date)` makes daily re-runs idempotent.
 * - `delta_dod` = today − latest-prior (null when no history; a brand-new metric
 *   reports no delta rather than a misleading +value).
 * - Empty `inputs` short-circuits to `[]` (zero-activity day writes nothing).
 */
export function computeSnapshotRows(
  inputs: MarketingMetricInput[] | null | undefined,
  asOfDate: Date,
  priorRows?: PriorSnapshotRow[] | null,
  options: ComputeSnapshotOptions = {}
): ComputedSnapshotRow[] {
  if (!inputs || inputs.length === 0) return []

  const capturedFor = istDayStart(asOfDate)
  const asOfMs = capturedFor.getTime()
  const source = options.source ?? "daily-refresh"

  return inputs.map((input) => {
    const prior = priorValueFor(input.metric_key, asOfMs, priorRows)
    const delta_dod = prior === null ? null : round2(input.value - prior)
    return {
      metric_key: input.metric_key,
      value: input.value,
      unit: input.unit ?? null,
      captured_for_date: capturedFor,
      source,
      breakdown: input.breakdown ?? null,
      delta_dod,
    }
  })
}

/** Avoid float drift in deltas (e.g. 0.1 - 0.3) without changing magnitude. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
