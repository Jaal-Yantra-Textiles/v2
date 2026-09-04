/**
 * Folding Kit's absolute subscriber stats into the engagement aggregate (#1785).
 *
 * Kit is a broadcast platform: it reports per-subscriber TOTALS
 * (`GET /v4/subscribers/{id}/stats`), never individual events. The aggregate in
 * `email_engagement` is otherwise built by `applyEngagement`, which folds ONE
 * webhook event at a time. The two cannot be mixed naively:
 *
 *   - overwriting destroys the Mailjet/Resend history already in the row
 *   - adding the totals is right once and double-counts on every re-run
 *   - taking the max is idempotent but undercounts anyone who receives BOTH
 *     transactional mail and the newsletter
 *
 * So we keep the last snapshot Kit gave us (`kit_*` columns) and apply the
 * DELTA. Re-running the backfill with unchanged stats is a no-op, and the two
 * populations add up honestly.
 *
 * Everything here is pure so the arithmetic is testable without Kit or a DB.
 */

/** The subset of `GET /v4/subscribers/{id}/stats` we consume. */
export type KitSubscriberStats = {
  sent?: number | null
  opened?: number | null
  clicked?: number | null
  last_sent?: string | null
  last_opened?: string | null
  last_clicked?: string | null
  sends_since_last_open?: number | null
}

export type EngagementRowForMerge = {
  delivered_count?: number | null
  opens_count?: number | null
  clicks_count?: number | null
  delivered_since_last_open?: number | null
  first_delivered_at?: string | Date | null
  last_delivered_at?: string | Date | null
  last_open_at?: string | Date | null
  last_click_at?: string | Date | null
  last_event_at?: string | Date | null
  kit_sent?: number | null
  kit_opened?: number | null
  kit_clicked?: number | null
}

export type KitMergeResult = {
  delivered_count: number
  opens_count: number
  clicks_count: number
  delivered_since_last_open: number
  first_delivered_at: string | null
  last_delivered_at: string | null
  last_open_at: string | null
  last_click_at: string | null
  last_event_at: string | null
  kit_sent: number
  kit_opened: number
  kit_clicked: number
  kit_synced_at: string
  /** false when nothing moved — the caller skips the write entirely. */
  changed: boolean
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

const iso = (v: string | Date | null | undefined): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const laterIso = (a: string | null, b: string | null): string | null => {
  if (!a) return b
  if (!b) return a
  return new Date(a) >= new Date(b) ? a : b
}

const earlierIso = (a: string | null, b: string | null): string | null => {
  if (!a) return b
  if (!b) return a
  return new Date(a) <= new Date(b) ? a : b
}

/**
 * The date of a subscriber's FIRST newsletter delivery, derived exactly.
 *
 * A tagged subscriber receives every broadcast from then on, so `sent = N`
 * means their deliveries are the last N broadcasts — their first is the Nth
 * from the end. This is not a proxy: no guessing from `created_at` (which
 * predates their first send and would overstate the dormancy span) or from
 * `tagged_at` (which is only a floor).
 *
 * @param broadcastSendsDesc every broadcast's send time, NEWEST FIRST.
 * @returns null when they have received nothing, or when we have fewer
 *          broadcasts on record than Kit says they were sent — in which case we
 *          genuinely do not know, and a null keeps them out of `dormant`.
 */
export function firstDeliveredAtFromSentCount(
  sent: number,
  broadcastSendsDesc: string[]
): string | null {
  const n = num(sent)
  if (n <= 0) return null
  if (n > broadcastSendsDesc.length) return null
  return iso(broadcastSendsDesc[n - 1])
}

/**
 * Fold one Kit stats snapshot into an existing engagement row.
 *
 * Deltas are clamped at zero: Kit's totals should only grow, but a subscriber
 * deleted and re-created there would report LOWER numbers, and a negative delta
 * must never claw back deliveries the transactional webhooks recorded.
 */
export function mergeKitStats(
  existing: EngagementRowForMerge | null | undefined,
  stats: KitSubscriberStats,
  opts: { firstDeliveredAt?: string | null; now?: Date } = {}
): KitMergeResult {
  const e = existing || {}
  const now = opts.now ?? new Date()

  const kitSent = num(stats.sent)
  const kitOpened = num(stats.opened)
  const kitClicked = num(stats.clicked)

  const dSent = Math.max(0, kitSent - num(e.kit_sent))
  const dOpened = Math.max(0, kitOpened - num(e.kit_opened))
  const dClicked = Math.max(0, kitClicked - num(e.kit_clicked))

  const lastSent = iso(stats.last_sent)
  const lastOpened = iso(stats.last_opened)
  const lastClicked = iso(stats.last_clicked)

  const delivered_count = num(e.delivered_count) + dSent
  const opens_count = num(e.opens_count) + dOpened
  const clicks_count = num(e.clicks_count) + dClicked

  // The cold streak is the one field we do NOT add: Kit computes it over its
  // own sends and our counter covers ours, so neither is the whole truth. Take
  // the LOWER of the two — a smaller streak keeps people on the list, matching
  // the conservative bias the webhook path already documents.
  const ourCold = num(e.delivered_since_last_open)
  const kitCold = num(stats.sends_since_last_open)
  const delivered_since_last_open =
    kitOpened > 0 || kitClicked > 0 ? Math.min(ourCold, kitCold) : ourCold + dSent

  const first_delivered_at = earlierIso(
    iso(e.first_delivered_at),
    iso(opts.firstDeliveredAt ?? null)
  )
  const last_delivered_at = laterIso(iso(e.last_delivered_at), lastSent)
  // A click proves engagement even when the open never registered — same rule
  // as applyEngagement.
  const last_open_at = laterIso(laterIso(iso(e.last_open_at), lastOpened), lastClicked)
  const last_click_at = laterIso(iso(e.last_click_at), lastClicked)
  const last_event_at = laterIso(
    iso(e.last_event_at),
    laterIso(last_delivered_at, last_open_at)
  )

  const changed =
    delivered_count !== num(e.delivered_count) ||
    opens_count !== num(e.opens_count) ||
    clicks_count !== num(e.clicks_count) ||
    delivered_since_last_open !== ourCold ||
    first_delivered_at !== iso(e.first_delivered_at) ||
    last_delivered_at !== iso(e.last_delivered_at) ||
    last_open_at !== iso(e.last_open_at) ||
    last_click_at !== iso(e.last_click_at)

  return {
    delivered_count,
    opens_count,
    clicks_count,
    delivered_since_last_open,
    first_delivered_at,
    last_delivered_at,
    last_open_at,
    last_click_at,
    last_event_at,
    kit_sent: kitSent,
    kit_opened: kitOpened,
    kit_clicked: kitClicked,
    kit_synced_at: now.toISOString(),
    changed,
  }
}
