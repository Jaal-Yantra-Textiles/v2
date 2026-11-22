/**
 * Expiry for the PayU payment links we mint on design orders (#2564).
 *
 * ## Why we own the expiry
 *
 * PayU's Payment Links API takes an `expiryDate`, but when none is sent the
 * link lives for **365 days** — and before #2564 we never sent one. So every
 * design-order link stayed payable for a year, at whatever price it was minted
 * with. After an amend (#2562) the buyer held a valid link for the OLD total:
 * paying it took their money and completed no order (the webhook refuses an
 * amount below the cart total).
 *
 * PayU sends NO "link expired" event for any of its products (checked
 * 2026-11-21). So expiry is ours end to end: we stamp `expires_at` on the cart,
 * a job (`expire-design-order-payu-links`) switches the link off at PayU once
 * it lapses and emails the buyer, and minting a new link switches off the old.
 *
 * Pure helpers only — the PayU calls live in `payu-link-admin.ts`.
 */

export const PAYU_LINK_METADATA_KEY = "payu_link"

/** How long a design-order PayU link stays payable. */
export const payuLinkTtlHours = (env: Record<string, string | undefined> = process.env): number => {
  const n = Number(env.DESIGN_ORDER_PAYU_LINK_TTL_HOURS)
  return Number.isFinite(n) && n > 0 ? n : 48
}

/**
 * What we keep on `cart.metadata.payu_link`. One link per cart — minting a new
 * one replaces this record, after switching the old link off at PayU.
 */
export type TrackedPayuLink = {
  invoice_number: string
  url: string
  /** ISO instant. */
  expires_at: string
  /** ISO instant. */
  created_at: string
  /** Set once the link has been switched off at PayU (or found already paid). */
  closed_at?: string | null
  /** Why it was closed: expired | completed | cancelled | replaced | paid. */
  closed_reason?: string | null
  /** Set once the buyer was emailed that the link expired. */
  expiry_notified_at?: string | null
  /**
   * #2572 — the UPI intent minted with this link, for the same amount. The
   * email's QR encodes it so any UPI app can pay. Unlike the link it cannot be
   * switched off at PayU; the webhook's amount check is the guard.
   */
  upi_intent?: {
    txnid: string
    uri: string
    amount: number
    payment_id: string | null
    created_at: string
  } | null
}

/** The QR payload for a tracked link: the UPI intent when we have one, else the link URL. */
export const qrPayloadFor = (
  link: TrackedPayuLink
): { kind: "upi" | "link"; data: string } => {
  const uri = link.upi_intent?.uri
  if (typeof uri === "string" && /^upi:\/\/pay\?/i.test(uri)) return { kind: "upi", data: uri }
  return { kind: "link", data: link.url }
}

const IST_OFFSET_MS = 330 * 60 * 1000

/**
 * PayU's create-link `expiryDate`: `yyyy-MM-dd HH:mm:ss`. The docs name no
 * timezone; PayU's own responses carry `+0530`, so we send IST wall time.
 */
export const toPayuIstDateTime = (d: Date): string => {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const p = (n: number) => String(n).padStart(2, "0")
  return (
    `${ist.getUTCFullYear()}-${p(ist.getUTCMonth() + 1)}-${p(ist.getUTCDate())} ` +
    `${p(ist.getUTCHours())}:${p(ist.getUTCMinutes())}:${p(ist.getUTCSeconds())}`
  )
}

/** "Mon 23 Nov 2026, 6:30 pm IST" — what the buyer reads. */
export const formatExpiryForBuyer = (d: Date): string => {
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const h24 = ist.getUTCHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const mm = String(ist.getUTCMinutes()).padStart(2, "0")
  return (
    `${days[ist.getUTCDay()]} ${ist.getUTCDate()} ${months[ist.getUTCMonth()]} ` +
    `${ist.getUTCFullYear()}, ${h12}:${mm} ${h24 < 12 ? "am" : "pm"} IST`
  )
}

/** Read the tracked link off a cart's metadata, or null if absent/malformed. */
export const readTrackedLink = (metadata: unknown): TrackedPayuLink | null => {
  const raw = (metadata as any)?.[PAYU_LINK_METADATA_KEY]
  if (!raw || typeof raw !== "object") return null
  if (typeof raw.invoice_number !== "string" || !raw.invoice_number) return null
  if (typeof raw.expires_at !== "string" || Number.isNaN(Date.parse(raw.expires_at))) return null
  return raw as TrackedPayuLink
}

export type LinkSweepAction =
  | { kind: "skip"; why: string }
  /** Switch the link off at PayU. `notify` → email the buyer it expired. */
  | { kind: "close"; reason: "expired" | "completed" | "cancelled"; notify: boolean }
  /** Closed earlier but the expiry email has not gone yet — retry it alone. */
  | { kind: "notify_only" }

/**
 * What the sweep should do with one cart. Order matters:
 *
 * 1. A completed cart → close the link, never email. The buyer paid (by
 *    checkout or by this link); an open link invites a SECOND payment.
 * 2. A cancelled design order → close, never email "expired" for an order we
 *    called off.
 * 3. Past `expires_at` → close and email.
 * 4. Closed as expired but never notified (email failed) → retry the email.
 */
export const decideLinkSweep = (input: {
  link: TrackedPayuLink | null
  completedAt: unknown
  cancelledAt: unknown
  hasEmail: boolean
  now: Date
}): LinkSweepAction => {
  const { link, now } = input
  if (!link) return { kind: "skip", why: "no tracked link" }

  if (link.closed_at) {
    if (
      link.closed_reason === "expired" &&
      !link.expiry_notified_at &&
      input.hasEmail &&
      !input.completedAt &&
      !input.cancelledAt
    ) {
      return { kind: "notify_only" }
    }
    return { kind: "skip", why: "already closed" }
  }

  if (input.completedAt) return { kind: "close", reason: "completed", notify: false }
  if (input.cancelledAt) return { kind: "close", reason: "cancelled", notify: false }
  if (Date.parse(link.expires_at) <= now.getTime()) {
    return { kind: "close", reason: "expired", notify: input.hasEmail }
  }
  return { kind: "skip", why: "still live" }
}
