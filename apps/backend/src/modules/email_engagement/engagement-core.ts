import { normalizeEmail } from "../email_suppression/suppress-core"
import { EMAIL_ENGAGEMENT_MODULE } from "./index"
import type { EngagementType } from "./provider-parsers"

/**
 * Shared engagement core — the ONE place a delivery/open/click event updates a
 * recipient's engagement rollup, called from the Mailjet + Resend delivery-event
 * webhooks. Writes a raw `email_engagement_event` row (idempotent on `event_id`)
 * and folds it into the `email_engagement` aggregate. Never suppresses anything
 * itself — the aggregate is read later by the engagement recompute, which does
 * the soft-exclusion. Sibling of `suppress-core`.
 */

export type EngagementProvider = "mailjet" | "resend" | "kit" | "other"

export type EngagementInput = {
  email: string
  type: EngagementType
  provider: EngagementProvider
  event_id?: string | null
  event_at?: string | null
  message_id?: string | null
  raw?: any
}

export type EngagementOutcome = {
  email: string
  type: EngagementType
  /** true when the aggregate was updated (first time we saw this event). */
  recorded: boolean
  /** true when skipped because the same event_id was already processed. */
  duplicate: boolean
}

/** The mutable counters `applyEngagement` returns (a partial aggregate row). */
export type EngagementAggregate = {
  delivered_count: number
  opens_count: number
  clicks_count: number
  delivered_since_last_open: number
  first_delivered_at: string | null
  last_delivered_at: string | null
  last_open_at: string | null
  last_click_at: string | null
  last_event_at: string | null
}

/** PURE: later of two ISO instants (either may be null/undefined). */
function laterIso(a: string | null | undefined, b: string): string {
  return !a || b > a ? b : a
}

/** PURE: earlier of two ISO instants (either may be null/undefined). */
function earlierIso(a: string | null | undefined, b: string): string {
  return !a || b < a ? b : a
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0
}

function iso(v: unknown): string | null {
  if (!v) return null
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

/**
 * PURE: fold one engagement event into the aggregate. `existing` is the current
 * row (or null/undefined for a brand-new email). Returns the next counter set.
 *
 *  - delivered → delivered_count++, extend the delivered-since-open cold streak
 *  - open      → opens_count++, reset the cold streak (they're alive)
 *  - click     → clicks_count++, reset the cold streak, and imply an open if we
 *                haven't recorded one (a click is a strictly stronger signal)
 *
 * Timestamps are folded order-independently (min for first_*, max for last_*),
 * so out-of-order webhook delivery can't corrupt them. The cold streak resets on
 * ANY open/click, so races only ever LOSE cold deliveries → we err toward
 * keeping people on the list, never toward wrongly marking them dormant.
 */
export function applyEngagement(
  existing: Partial<EngagementAggregate> | null | undefined,
  type: EngagementType,
  at: string
): EngagementAggregate {
  const e = existing || {}
  const next: EngagementAggregate = {
    delivered_count: num(e.delivered_count),
    opens_count: num(e.opens_count),
    clicks_count: num(e.clicks_count),
    delivered_since_last_open: num(e.delivered_since_last_open),
    first_delivered_at: iso(e.first_delivered_at),
    last_delivered_at: iso(e.last_delivered_at),
    last_open_at: iso(e.last_open_at),
    last_click_at: iso(e.last_click_at),
    last_event_at: iso(e.last_event_at),
  }

  if (type === "delivered") {
    next.delivered_count += 1
    next.delivered_since_last_open += 1
    next.last_delivered_at = laterIso(next.last_delivered_at, at)
    next.first_delivered_at = earlierIso(next.first_delivered_at, at)
  } else if (type === "open") {
    next.opens_count += 1
    next.delivered_since_last_open = 0
    next.last_open_at = laterIso(next.last_open_at, at)
  } else if (type === "click") {
    next.clicks_count += 1
    next.delivered_since_last_open = 0
    next.last_click_at = laterIso(next.last_click_at, at)
    // A click implies engagement even if the open event never reached us.
    next.last_open_at = laterIso(next.last_open_at, at)
  }

  next.last_event_at = laterIso(next.last_event_at, at)
  return next
}

/**
 * Record one engagement event: idempotent raw-row insert + aggregate fold.
 * Container-driven (resolves the email_engagement service).
 */
export async function recordEngagement(
  container: any,
  input: EngagementInput
): Promise<EngagementOutcome> {
  const email = normalizeEmail(input.email)
  const type = input.type
  const at = input.event_at || new Date().toISOString()

  const base: EngagementOutcome = { email, type, recorded: false, duplicate: false }
  if (!email) return base

  const service: any = container.resolve(EMAIL_ENGAGEMENT_MODULE)

  // Idempotency: same provider event already folded in → no-op.
  if (input.event_id) {
    const seen = await service
      .listEmailEngagementEvents({ event_id: input.event_id }, { take: 1 })
      .catch(() => [])
    if (seen?.length) return { ...base, duplicate: true }
  }

  // Raw audit row (best-effort — a logging failure never fails the caller, but
  // we still fold the aggregate since the dedup guard already passed).
  try {
    await service.createEmailEngagementEvents({
      email,
      type,
      provider: input.provider,
      event_id: input.event_id ?? null,
      event_at: at,
      message_id: input.message_id ?? null,
      raw: input.raw ?? null,
    })
  } catch {
    // swallow — aggregate still updates below
  }

  // Fold into the aggregate (read-modify-write; volume is low).
  const existing = (
    await service.listEmailEngagements({ email }, { take: 1 }).catch(() => [])
  )?.[0]
  const folded = applyEngagement(existing, type, at)
  if (existing) {
    await service.updateEmailEngagements({ id: existing.id, ...folded })
  } else {
    try {
      await service.createEmailEngagements({ email, ...folded })
    } catch {
      // A concurrent event for this same new email may have created the row
      // first (UNIQUE(email)). Re-read and fold into what's now there.
      const now = (
        await service.listEmailEngagements({ email }, { take: 1 }).catch(() => [])
      )?.[0]
      if (now) {
        await service.updateEmailEngagements({
          id: now.id,
          ...applyEngagement(now, type, at),
        })
      }
    }
  }

  return { ...base, recorded: true }
}
