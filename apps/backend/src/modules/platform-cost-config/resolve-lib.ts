/**
 * Platform cost-config resolution (#1939).
 *
 * A PURE library — no container, no I/O. Given the rows and a moment, it picks
 * the policy in force and reads numbers out of it safely. The I/O wrapper that
 * loads rows from the module lives in `read-config.ts`.
 *
 * Pure because the interesting logic is entirely in the edge cases — a null that
 * must not become 0, a future-dated row that must not take effect early — and
 * those deserve unit tests that cannot be faked by a stubbed container.
 */

/** A row of `platform_cost_config` (only the fields resolution reads). */
export interface PlatformCostConfigRow {
  id?: string | null
  effective_from?: Date | string | null
  is_active?: boolean | null
  notes?: string | null
  platform_fee_percent?: number | string | null
  production_overhead_percent?: number | string | null
  default_material_cost?: number | string | null
  default_material_cost_currency?: string | null
  custom_design_markup_percent?: number | string | null
  approval_markup_multiplier?: number | string | null
}

/**
 * PURE: coerce a stored numeric to a usable number, preserving ABSENCE.
 *
 * 🔴 The whole point is that this returns `null` — not `0` — for an unset value.
 * `Number(null)` is `0`, `Number("")` is `0` and `Number(undefined)` is `NaN`,
 * so a naive `Number(row.field)` turns "nobody decided" into "the fee is zero"
 * and bills a partner accordingly. `0` itself is preserved, because a zero fee
 * is a real policy and must survive.
 *
 * Also rejects NaN and Infinity: a corrupt row must read as absent, not as a
 * number that poisons every arithmetic downstream of it.
 */
export function readNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === "string" && value.trim() === "") {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** PURE: parse `effective_from` to epoch ms, or null when unusable. */
export function effectiveAtMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null
  }
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Resolve the policy in force at `at` (default: now).
 *
 * The active row with the LATEST `effective_from` at or before `at`. Rows that
 * are inactive, undated, or dated in the future are skipped — so a policy can be
 * staged ahead of time without silently taking effect, and a row with a broken
 * date is ignored rather than being treated as the epoch (which would make it
 * win nothing) or as now (which would make it win everything).
 *
 * Returns null when nothing is in force. A caller MUST treat that as "no
 * configured policy" and fall back explicitly — never as zeros.
 */
export function resolveCostConfig(
  rows: PlatformCostConfigRow[] | null | undefined,
  at: Date = new Date()
): PlatformCostConfigRow | null {
  const atMs = at.getTime()
  let best: PlatformCostConfigRow | null = null
  let bestMs = -Infinity

  for (const row of rows ?? []) {
    if (!row || row.is_active === false) {
      continue
    }
    const ms = effectiveAtMs(row.effective_from)
    if (ms === null || ms > atMs) {
      continue
    }
    if (ms > bestMs) {
      best = row
      bestMs = ms
    }
  }
  return best
}

/** The numbers a caller actually wants, with absence preserved throughout. */
export interface ResolvedCostConfig {
  platform_fee_percent: number | null
  production_overhead_percent: number | null
  default_material_cost: number | null
  default_material_cost_currency: string | null
  custom_design_markup_percent: number | null
  approval_markup_multiplier: number | null
  /** The row these came from, for recording WHAT WAS USED alongside a price. */
  source_config_id: string | null
  /** When that policy took effect — the other half of an auditable price. */
  effective_from: Date | null
}

/**
 * PURE: flatten a row into typed numbers, every one of which may be null.
 *
 * Returns an all-null shape when there is no row, rather than throwing: a caller
 * that has no policy configured is in a normal state (a fresh install), and the
 * nulls make it apply its own documented fallbacks. What it must never get is
 * zeros, which would look like a decision.
 *
 * `source_config_id` and `effective_from` come back so a caller can record which
 * policy a price was computed under — #1939 asks for "what it used at the time,
 * rather than recomputing history", and that is impossible without the id.
 */
export function readCostConfig(
  row: PlatformCostConfigRow | null | undefined
): ResolvedCostConfig {
  const effMs = effectiveAtMs(row?.effective_from)
  return {
    platform_fee_percent: readNumber(row?.platform_fee_percent),
    production_overhead_percent: readNumber(row?.production_overhead_percent),
    default_material_cost: readNumber(row?.default_material_cost),
    default_material_cost_currency: row?.default_material_cost_currency ?? null,
    custom_design_markup_percent: readNumber(row?.custom_design_markup_percent),
    approval_markup_multiplier: readNumber(row?.approval_markup_multiplier),
    source_config_id: row?.id ?? null,
    effective_from: effMs === null ? null : new Date(effMs),
  }
}
