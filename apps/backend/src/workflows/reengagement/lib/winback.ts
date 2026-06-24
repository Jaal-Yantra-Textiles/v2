// Pure, side-effect-free helpers for the lapsed-customer win-back trigger (#450).
//
// Kept free of Medusa/container deps so the "is this customer due for a
// win-back?" selection, idempotency guard and email-data assembly are
// unit-testable without booting Medusa, a DB, or a notification provider.
//
// Pairs with the `win-back` email template seeded in
// `seed-reengagement-email-templates.ts` (#715). Mirrors the shape of the
// `feedback-reminder` lib so both lifecycle triggers read the same way.
//
// Idempotency: after a successful send we stamp `customer.metadata.winback_sent_at`.
// A customer is only re-eligible once `cooldownDays` have elapsed since that
// stamp, so a re-run (or a still-lapsed customer next cycle) never double-sends
// within the cooldown window.

export interface WinbackCustomerRow {
  id: string
  email?: string | null
  first_name?: string | null
  last_name?: string | null
  metadata?: Record<string, any> | null
  /** Most recent order timestamp; null/absent when the customer never ordered. */
  last_order_at?: Date | string | null
  /** Total orders placed by this customer. Must be >= 1 to qualify. */
  order_count?: number | null
  /** Display id of the most recent order (optional — used only for email copy). */
  last_order_display?: number | string | null
}

export interface SelectWinbackOptions {
  /** Reference "now" — defaults to a fresh Date. */
  now?: Date
  /** Min days since the customer's last order before a win-back is due. */
  minLapsedDays?: number
  /** Don't re-send a win-back to the same customer within this many days. */
  cooldownDays?: number
  /** Cap on how many win-backs one run will send. */
  maxBatch?: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export const DEFAULT_MIN_LAPSED_DAYS = 90
export const DEFAULT_COOLDOWN_DAYS = 180
export const DEFAULT_MAX_BATCH = 100

function toTime(value: Date | string | null | undefined): number {
  if (!value) {
    return NaN
  }
  return new Date(value).getTime()
}

/**
 * Has a win-back already been sent to this customer within the cooldown window?
 * Presence of a recent `metadata.winback_sent_at` is the idempotency guard.
 */
export function winbackOnCooldown(
  row: WinbackCustomerRow,
  now: Date,
  cooldownDays: number
): boolean {
  const sentAt = toTime(row?.metadata?.winback_sent_at)
  if (Number.isNaN(sentAt)) {
    return false
  }
  return now.getTime() - sentAt < cooldownDays * MS_PER_DAY
}

/**
 * Select lapsed customers due for a win-back: have an email, have placed at
 * least one order, whose most recent order is older than `minLapsedDays`, and
 * who haven't been win-backed within `cooldownDays`. Sorted longest-lapsed
 * first and capped at `maxBatch`.
 */
export function selectWinbackDue(
  customers: WinbackCustomerRow[] | null | undefined,
  options: SelectWinbackOptions = {}
): WinbackCustomerRow[] {
  const now = options.now ?? new Date()
  const minLapsedDays = options.minLapsedDays ?? DEFAULT_MIN_LAPSED_DAYS
  const cooldownDays = options.cooldownDays ?? DEFAULT_COOLDOWN_DAYS
  const maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH
  if (!Array.isArray(customers) || customers.length === 0) {
    return []
  }

  const cutoff = now.getTime() - minLapsedDays * MS_PER_DAY

  const due = customers
    .filter((c) => {
      if (!c || !c.id) {
        return false
      }
      if (!(c.email || "").trim()) {
        return false
      }
      if (!c.order_count || c.order_count < 1) {
        return false
      }
      const last = toTime(c.last_order_at)
      if (Number.isNaN(last) || last > cutoff) {
        return false
      }
      if (winbackOnCooldown(c, now, cooldownDays)) {
        return false
      }
      return true
    })
    .sort((a, b) => toTime(a.last_order_at) - toTime(b.last_order_at))

  return due.slice(0, Math.max(0, maxBatch))
}

/**
 * Turn a day count into friendly copy for the `days_since` template variable.
 * Months once it's been ~2 months, weeks once it's been a couple, else days.
 */
export function humanizeDaysSince(days: number): string {
  const d = Math.max(0, Math.round(days))
  if (d >= 60) {
    return `${Math.round(d / 30)} months`
  }
  if (d >= 14) {
    return `${Math.round(d / 7)} weeks`
  }
  return `${d} ${d === 1 ? "day" : "days"}`
}

export interface WinbackEmailInput {
  customer: WinbackCustomerRow
  /** Storefront base URL for the CTA (may be ""). */
  shopBase: string
  now?: Date
}

export interface WinbackEmail {
  /** Recipient — "" when the customer has no email (send is then skipped). */
  to: string
  template: "win-back"
  data: {
    customer_name: string
    last_order_display: string
    days_since: string
    shop_url: string
    current_year: number
  }
}

/**
 * Assemble the Handlebars data for the `win-back` template. Mirrors the
 * variables seeded in `seed-reengagement-email-templates.ts` (#715). Optional
 * fields (`discount_code`) are intentionally omitted — the template hides them.
 */
export function buildWinbackEmailData(input: WinbackEmailInput): WinbackEmail {
  const { customer, shopBase } = input
  const now = input.now ?? new Date()

  const last = toTime(customer.last_order_at)
  const daysSince = Number.isNaN(last)
    ? ""
    : humanizeDaysSince((now.getTime() - last) / MS_PER_DAY)

  const display = customer.last_order_display
  const lastOrderDisplay =
    display !== undefined && display !== null && `${display}` !== ""
      ? `#${display}`
      : ""

  return {
    to: (customer.email || "").trim(),
    template: "win-back",
    data: {
      customer_name: (customer.first_name || "").trim() || "there",
      last_order_display: lastOrderDisplay,
      days_since: daysSince,
      shop_url: shopBase,
      current_year: now.getFullYear(),
    },
  }
}
