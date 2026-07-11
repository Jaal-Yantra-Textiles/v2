/**
 * PURE engagement classifier — the single policy that turns an `email_engagement`
 * aggregate into a status. Read by BOTH the recompute job (persists the status
 * for visibility + win-back selection) and the send path (live gate: `dormant`
 * drops from BULK sends). No IO — fully unit-testable.
 *
 * Policy (soft exclusion — see #3): only `dormant` is bulk-suppressed. `cooling`
 * is the pre-dormant win-back target; `never_opened` / `engaged` / `unknown`
 * still get mailed. Any open/click proves delivery + interest, so an engaged
 * contact is judged on their cold streak regardless of how many `delivered`
 * events we recorded (a provider may report opens but not deliveries). Only a
 * contact with NO opens AND too few deliveries to judge is `unknown`.
 */

export type EngagementStatus =
  | "engaged"
  | "cooling"
  | "dormant"
  | "never_opened"
  | "unknown"

export type EngagementThresholds = {
  /** Below this many deliveries we can't judge → `unknown`. */
  minDataDelivered: number
  /** Cold streak (deliveries since last open) that tips an ever-engaged contact
   * to `dormant` — and, for a never-opened contact, the delivery count. */
  dormantColdStreak: number
  /** …but only once the first delivery is at least this many days old (so a
   * fresh burst of sends can't dormant someone overnight). */
  dormantMinSpanDays: number
  /** Cold streak that flags an ever-engaged contact as `cooling` (win-back). */
  coolingColdStreak: number
}

export const DEFAULT_ENGAGEMENT_THRESHOLDS: EngagementThresholds = {
  minDataDelivered: 3,
  dormantColdStreak: 5,
  dormantMinSpanDays: 30,
  coolingColdStreak: 3,
}

/** The aggregate columns the classifier reads (subset of `email_engagement`). */
export type EngagementRow = {
  delivered_count?: number | null
  opens_count?: number | null
  clicks_count?: number | null
  delivered_since_last_open?: number | null
  first_delivered_at?: Date | string | null
}

export type EngagementClassification = {
  status: EngagementStatus
  /** true when this status is excluded from BULK sends (only `dormant`). */
  bulk_suppressed: boolean
  /** short human reason, for the recompute audit + UI. */
  reason: string
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function n(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function spanDays(first: Date | string | null | undefined, now: Date): number {
  if (!first) return 0
  const t = new Date(first).getTime()
  if (Number.isNaN(t)) return 0
  return (now.getTime() - t) / MS_PER_DAY
}

/** Which statuses are dropped from bulk sends. Single source of the gate. */
export function isBulkSuppressed(status: EngagementStatus): boolean {
  return status === "dormant"
}

/**
 * Classify one aggregate. `now` is injected (defaults to a fresh Date) so the
 * recompute + tests are deterministic.
 */
export function classifyEngagement(
  row: EngagementRow,
  opts: { now?: Date; thresholds?: Partial<EngagementThresholds> } = {}
): EngagementClassification {
  const now = opts.now ?? new Date()
  const th = { ...DEFAULT_ENGAGEMENT_THRESHOLDS, ...(opts.thresholds ?? {}) }

  const delivered = n(row.delivered_count)
  const opens = n(row.opens_count)
  const clicks = n(row.clicks_count)
  const cold = n(row.delivered_since_last_open)
  const span = spanDays(row.first_delivered_at, now)

  const wrap = (status: EngagementStatus, reason: string): EngagementClassification => ({
    status,
    bulk_suppressed: isBulkSuppressed(status),
    reason,
  })

  const everEngaged = opens > 0 || clicks > 0
  const oldEnough = span >= th.dormantMinSpanDays

  // An open or click PROVES the message was delivered and the contact is real —
  // so we always have enough signal to judge them, regardless of how many
  // `delivered` webhooks we happened to record. This matters when a provider
  // (e.g. Mailjet without its `sent` trigger) reports opens but not deliveries:
  // without this, an engaged opener would fall through to `unknown`. Judge on
  // the cold streak since their last open.
  if (everEngaged) {
    if (cold >= th.dormantColdStreak && oldEnough) {
      return wrap("dormant", `${cold} deliveries since last open over ${Math.round(span)}d`)
    }
    if (cold >= th.coolingColdStreak) {
      return wrap("cooling", `${cold} deliveries since last open`)
    }
    return wrap("engaged", `recent open/click (cold streak ${cold})`)
  }

  // Never opened/clicked — now we DO need enough delivery signal to judge,
  // otherwise there's nothing to go on. Thin data → unknown (never suppressed).
  if (delivered < th.minDataDelivered) {
    return wrap("unknown", `only ${delivered} delivered (< ${th.minDataDelivered}), no opens`)
  }
  if (delivered >= th.dormantColdStreak && oldEnough) {
    return wrap("dormant", `never opened in ${delivered} deliveries over ${Math.round(span)}d`)
  }
  return wrap("never_opened", `opens=0 after ${delivered} deliveries (${Math.round(span)}d)`)
}
