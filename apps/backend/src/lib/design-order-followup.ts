// Follow-up for design orders nobody has paid: a gentle reminder on day 3, a
// last call on day 6, and on day 7 the order is closed (soft-cancelled, the
// designs are kept) with a note on how to start again.
//
// PURE — the maintenance job `design-order-followup` loads the carts, rules out
// any with money received, and acts on what this returns.

export const DAY_MS = 24 * 60 * 60 * 1000

export const FOLLOWUP_REMINDER_DAY = 3
export const FOLLOWUP_LAST_CALL_DAY = 6
export const FOLLOWUP_CLOSE_DAY = 7
/** The last call must have been out this long before we close. */
export const FOLLOWUP_LAST_CALL_NOTICE_MS = 20 * 60 * 60 * 1000

/**
 * 🔑 Carts already open when this shipped start their 7 days HERE, not at their
 * own creation: an 8-day-old cart must not be cancelled the morning the flow
 * is switched on.
 */
export const FOLLOWUP_CLOCK_FLOOR = "2026-11-25T00:00:00.000Z"

export const DESIGN_ORDER_REMINDER_TEMPLATE = "design-order-reminder"
export const DESIGN_ORDER_LAST_CALL_TEMPLATE = "design-order-last-call"

export const FOLLOWUP_CLOSE_REASON =
  "Closed automatically: not paid within 7 days of being sent (design-order follow-up)."

export const FOLLOWUP_CLOSE_BUYER_MESSAGE =
  "We held your design order for a week and didn't hear back, so we've closed it for now. " +
  "Your designs stay with us. When you're ready, reply to this email and we'll send you a new " +
  "design order with up-to-date prices."

export type FollowupState = {
  anchor?: string
  reminder_sent_at?: string
  last_call_sent_at?: string
}

export type FollowupCart = {
  id: string
  created_at?: string | Date | null
  completed_at?: string | Date | null
  metadata?: Record<string, any> | null
}

export type FollowupAction =
  | { action: "skip"; reason: string }
  | { action: "wait"; anchor: string; day: number; close_on: string }
  | { action: "remind" | "last_call" | "close"; anchor: string; day: number; close_on: string }

const ms = (v: unknown): number | null => {
  if (v == null || v === "") return null
  const t = new Date(v as any).getTime()
  return Number.isFinite(t) ? t : null
}

const hasText = (v: unknown) => typeof v === "string" && v.trim().length > 0

/**
 * When the 7 days started: the LAST time the order was sent. A change that is
 * re-sent mints a fresh payment link, so its `payu_link.created_at` moves the
 * clock — the founder's rule is "every change and resend gets a fresh 7 days".
 * Never before FOLLOWUP_CLOCK_FLOOR.
 */
export const followupAnchor = (cart: FollowupCart): string => {
  const md = cart.metadata ?? {}
  const candidates = [
    ms(cart.created_at),
    ms(md.payu_link?.created_at),
    ms(FOLLOWUP_CLOCK_FLOOR),
  ].filter((t): t is number => t != null)
  return new Date(Math.max(...candidates)).toISOString()
}

/** "2 December 2026", in UTC so a buyer abroad sees the same date we do. */
export const formatCloseOn = (anchorIso: string): string =>
  new Date(new Date(anchorIso).getTime() + FOLLOWUP_CLOSE_DAY * DAY_MS).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })

/**
 * What to do with one design-order cart today. Ordered checks: anything that
 * is not an open, unpaid, reachable design order is skipped before the clock
 * is read.
 */
export const planDesignOrderFollowup = (
  cart: FollowupCart,
  input: { now: number; has_email: boolean; money_received: boolean }
): FollowupAction => {
  const md = cart.metadata ?? {}
  if (md.source !== "design-order") return { action: "skip", reason: "not a design order" }
  if (cart.completed_at) return { action: "skip", reason: "completed" }
  if (hasText(md.cancelled_at)) return { action: "skip", reason: "already cancelled" }
  if (hasText(md.converted_order_id)) return { action: "skip", reason: "converted to an order" }
  if (hasText(md.payu_completed_txnid)) return { action: "skip", reason: "paid" }
  if (input.money_received) return { action: "skip", reason: "deposit or payment received" }
  if (!input.has_email) return { action: "skip", reason: "no buyer email" }

  const anchor = followupAnchor(cart)
  const day = Math.floor((input.now - new Date(anchor).getTime()) / DAY_MS)
  const close_on = formatCloseOn(anchor)

  // A resend moved the clock: earlier reminders belonged to the old order.
  const prior: FollowupState = md.design_order_followup ?? {}
  const state: FollowupState = prior.anchor === anchor ? prior : {}

  if (day >= FOLLOWUP_CLOSE_DAY) {
    const lastCall = ms(state.last_call_sent_at)
    if (lastCall != null && input.now - lastCall >= FOLLOWUP_LAST_CALL_NOTICE_MS) {
      return { action: "close", anchor, day, close_on }
    }
    // Never close without warning: send the last call now, close next run.
    if (lastCall == null) return { action: "last_call", anchor, day, close_on }
    return { action: "wait", anchor, day, close_on }
  }
  if (day >= FOLLOWUP_LAST_CALL_DAY && !state.last_call_sent_at) {
    return { action: "last_call", anchor, day, close_on }
  }
  if (day >= FOLLOWUP_REMINDER_DAY && !state.reminder_sent_at && !state.last_call_sent_at) {
    return { action: "remind", anchor, day, close_on }
  }
  return { action: "wait", anchor, day, close_on }
}

/** The state to store after an action, so tomorrow's run moves on. */
export const nextFollowupState = (
  prior: FollowupState | undefined,
  action: "remind" | "last_call",
  anchor: string,
  nowIso: string
): FollowupState => {
  const base: FollowupState = prior?.anchor === anchor ? { ...prior } : { anchor }
  if (action === "remind") base.reminder_sent_at = nowIso
  else base.last_call_sent_at = nowIso
  return base
}
