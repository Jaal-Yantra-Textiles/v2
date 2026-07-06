import {
  classifyEngagement,
  type EngagementRow,
  type EngagementThresholds,
} from "./classifier"

/**
 * PURE newsletter win-back selection (Slice 3). Picks `cooling` contacts — the
 * pre-dormant nudge window: engaged before, now on a cold streak but not yet
 * `dormant`. Mirrors the marketing `selectWinbackTargets` shape so the job stays
 * thin + unit-testable. Idempotency is presence-based (skip anyone already in
 * the `newsletter-winback` campaign), matching `generate-winback-targets`.
 *
 * Targets become `marketing_outreach` rows (Option C) — we do NOT auto-blast;
 * the existing outreach flow handles sending, and the opens/clicks that flow
 * back are reconciled by the bridge we wired in Slice 1.
 */

export type WinbackEngagementRow = EngagementRow & {
  email?: string | null
  last_open_at?: Date | string | null
  last_delivered_at?: Date | string | null
}

export type NewsletterWinbackTarget = {
  email: string
  cold_streak: number
  last_open_at: string | null
  last_delivered_at: string | null
}

export type NewsletterWinbackSelection = {
  targets: NewsletterWinbackTarget[]
  stats: {
    scanned: number
    cooling: number
    targeted: number
    capped: number
    skipped_no_email: number
    skipped_already: number
  }
}

export type SelectNewsletterWinbackOptions = {
  now?: Date
  thresholds?: Partial<EngagementThresholds>
  cap?: number
}

export const DEFAULT_WINBACK_CAP = 100

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null
  return v instanceof Date ? v.toISOString() : String(v)
}

function normEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase()
}

export function selectNewsletterWinbackTargets(
  rows: WinbackEngagementRow[] | null | undefined,
  alreadyTargeted: Set<string>,
  options: SelectNewsletterWinbackOptions = {}
): NewsletterWinbackSelection {
  const now = options.now ?? new Date()
  const cap = options.cap ?? DEFAULT_WINBACK_CAP
  const list = Array.isArray(rows) ? rows : []

  const stats = {
    scanned: list.length,
    cooling: 0,
    targeted: 0,
    capped: 0,
    skipped_no_email: 0,
    skipped_already: 0,
  }

  const candidates: NewsletterWinbackTarget[] = []
  for (const r of list) {
    const { status } = classifyEngagement(r, { now, thresholds: options.thresholds })
    if (status !== "cooling") continue
    stats.cooling++

    const email = normEmail(r.email)
    if (!email) {
      stats.skipped_no_email++
      continue
    }
    if (alreadyTargeted.has(email)) {
      stats.skipped_already++
      continue
    }
    candidates.push({
      email,
      cold_streak: Number(r.delivered_since_last_open ?? 0),
      last_open_at: iso(r.last_open_at),
      last_delivered_at: iso(r.last_delivered_at),
    })
  }

  // Coldest first — the ones closest to tipping dormant get nudged first.
  candidates.sort((a, b) => b.cold_streak - a.cold_streak)

  const targets = candidates.slice(0, Math.max(0, cap))
  stats.targeted = targets.length
  stats.capped = Math.max(0, candidates.length - targets.length)

  return { targets, stats }
}
