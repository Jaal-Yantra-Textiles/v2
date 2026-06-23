/**
 * summarize-ideas-log.ts — pure helpers for the admin ideas-log read route
 * (#659 slice 2, PR-5). Kept pure (no container/DB) so the roll-up + sort logic
 * is unit-testable in isolation and the route stays a thin adapter.
 */

/** The subset of a `marketing_ideas_log` row the read route exposes/aggregates. */
export type IdeasLogRowLike = {
  id?: string
  generated_for_date?: string | Date | null
  model_used?: string | null
  guard_passed?: boolean | null
  guard_failures?: unknown
  regenerated?: boolean | null
  sent?: boolean | null
  output_text?: string | null
}

export type IdeasLogSummary = {
  total: number
  /** Rows whose hallucination guard passed. */
  guard_passed: number
  /** Rows whose guard failed (generated but withheld / flagged for review). */
  guard_failed: number
  /** Rows that were actually emailed out. */
  sent: number
  /** Generated-but-not-sent (guard fail OR send skipped). */
  not_sent: number
  /** Rows the AI had to regenerate once before guarding. */
  regenerated: number
}

/**
 * Roll up a set of ideas-log rows. Computed over the FULL filtered set (not a
 * paginated page) so totals stay correct regardless of offset/limit — the
 * page-vs-set bug (#484).
 */
export function summarizeIdeasLog(rows: IdeasLogRowLike[]): IdeasLogSummary {
  const summary: IdeasLogSummary = {
    total: 0,
    guard_passed: 0,
    guard_failed: 0,
    sent: 0,
    not_sent: 0,
    regenerated: 0,
  }
  if (!Array.isArray(rows)) {
    return summary
  }
  for (const row of rows) {
    summary.total++
    if (row?.guard_passed === true) {
      summary.guard_passed++
    } else {
      summary.guard_failed++
    }
    if (row?.sent === true) {
      summary.sent++
    } else {
      summary.not_sent++
    }
    if (row?.regenerated === true) {
      summary.regenerated++
    }
  }
  return summary
}

/** Epoch millis for a row's `generated_for_date`; 0 when missing/invalid. */
function toTime(value: string | Date | null | undefined): number {
  if (!value) {
    return 0
  }
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isFinite(t) ? t : 0
}

/**
 * Sort newest-first by `generated_for_date` (the operator audits the most recent
 * sends first). Pure — returns a new array, does not mutate the input.
 */
export function sortIdeasLogNewestFirst<T extends IdeasLogRowLike>(
  rows: T[]
): T[] {
  if (!Array.isArray(rows)) {
    return []
  }
  return [...rows].sort((a, b) => toTime(b?.generated_for_date) - toTime(a?.generated_for_date))
}

/** Parse a query string into a non-negative integer with a fallback. */
export function parseNonNegativeInt(
  value: unknown,
  fallback: number
): number {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback
  }
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n < 0) {
    return fallback
  }
  return n
}

/**
 * Parse a `?flag=true|false|1|0` query value into a boolean filter, or undefined
 * when the param is absent/unrecognised (so it isn't applied as a filter).
 */
export function parseBoolFilter(value: unknown): boolean | undefined {
  if (value === true || value === false) {
    return value
  }
  if (typeof value !== "string") {
    return undefined
  }
  const v = value.trim().toLowerCase()
  if (v === "true" || v === "1") {
    return true
  }
  if (v === "false" || v === "0") {
    return false
  }
  return undefined
}
