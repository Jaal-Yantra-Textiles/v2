import crypto from "crypto"

/**
 * Quote-link token mechanics. Deliberately the same shape as
 * `designer-invite/lib/token.ts` — high-entropy raw value in the URL, sha256 at
 * rest — rather than the stateless HMAC in
 * `api/store/products/preview/lib/token.ts`, which cannot expire or be revoked.
 * Both are founder decisions on a quote, so the token has to carry state.
 */

/** Default lifetime of a quote link. Partner-overridable at mint. */
export const DEFAULT_QUOTE_TTL_DAYS = 14

/**
 * Mint a quote token. `raw` goes in the URL and is returned to the caller
 * exactly once; only `hash` is persisted.
 */
export function generateQuoteToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url")
  return { raw, hash: hashQuoteToken(raw) }
}

export function hashQuoteToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

/** Absolute expiry from a mint time and a TTL in days. */
export function quoteExpiryFrom(
  now: Date,
  ttlDays: number = DEFAULT_QUOTE_TTL_DAYS
): Date {
  return new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000)
}

export type QuoteLifecycle = {
  status: string
  expires_at?: Date | string | null
}

/**
 * Why a quote cannot be viewed live, or null when it can.
 *
 * Expiry is derived here, at read time — no cron sweeper flips rows, so an
 * expired quote is still a readable record of what was said rather than a
 * mutated one. Pure: callers pass `now` so it stays deterministic.
 */
export function quoteUnusableReason(
  quote: QuoteLifecycle,
  /**
   * 🔴 `Date | string | number`, not `Date`.
   *
   * A workflow step's input AND output are serialized across the step
   * boundary, so a `Date` handed from one step to the next arrives as an ISO
   * STRING. `accept-quote` did exactly that and every acceptance died on
   * `now.getTime is not a function` — a 500 the buyer saw as "Accept and order
   * does not work". tsc could not see it: the declared step types describe the
   * workflow GRAPH, not the runtime payload, so the call site type-checked
   * against a `Date` that never arrives.
   *
   * The same trap already cost the mint a 100% failure rate
   * (`mintPriceListStep`, where `.toISOString()` threw). Normalising HERE, in
   * the one helper both the buyer page and the accept path call, is what stops
   * a third caller finding it a third time.
   */
  now: Date | string | number
): "revoked" | "superseded" | "expired" | null {
  const nowMs = new Date(now as any).getTime()
  if (quote.status === "revoked") return "revoked"
  // Checked before expiry: a superseded quote is usually still inside its own
  // TTL, and "a newer quote replaced this" is the more useful thing to say than
  // "this expired" — the buyer has somewhere to go.
  if (quote.status === "superseded") return "superseded"
  if (
    quote.expires_at &&
    Number.isFinite(nowMs) &&
    new Date(quote.expires_at).getTime() <= nowMs
  ) {
    return "expired"
  }
  return null
}

export function isQuoteUsable(
  quote: QuoteLifecycle,
  now: Date | string | number
): boolean {
  return quoteUnusableReason(quote, now) === null
}

/**
 * Whole days until expiry, floored at 0. Drives the amber "expiring" state.
 *
 * Same widened `now` as its sibling, and for the same reason: these three
 * helpers are the lifecycle vocabulary, they are called from both a request
 * handler (where `now` is a real Date) and from inside workflow steps (where
 * it has been through JSON), and one of them being strict is all it takes.
 */
export function daysUntilExpiry(
  quote: QuoteLifecycle,
  now: Date | string | number
): number | null {
  if (!quote.expires_at) return null
  const nowMs = new Date(now as any).getTime()
  if (!Number.isFinite(nowMs)) return null
  const ms = new Date(quote.expires_at).getTime() - nowMs
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}

/**
 * The four words an operator may read on a quote.
 *
 * `expired` is deliberately NOT in `PartnerQuote.status` — see below.
 */
export const EFFECTIVE_QUOTE_STATUSES = [
  "active",
  "expired",
  "revoked",
  "superseded",
] as const

export type EffectiveQuoteStatus = (typeof EFFECTIVE_QUOTE_STATUSES)[number]

/**
 * What the quote's status ACTUALLY is, now (#1510).
 *
 * `PartnerQuote.status` is `active | revoked | superseded` and nothing moves a
 * row out of `active` when `expires_at` passes — so every list filtered to
 * `status=active` counted dead quotes as live, while the buyer page (which
 * derives expiry at read time) correctly refused to price the very same link.
 * The defect was never a mispriced quote: it was that `active` did not mean
 * active, on the one word an operator reads to answer "is this offer still
 * standing".
 *
 * 🔑 Derived, not swept. A cron that flipped rows would mutate a partner's
 * record behind their back and would need a migration to widen the enum; this
 * keeps `status` as the stored FACT and adds the computed one beside it. The
 * model's docblock has said "expiry is derived at read time" since S3 — this
 * is the list half of that promise, which was simply never written.
 *
 * 🔴 Built on `quoteUnusableReason` rather than re-deriving expiry, so the list
 * and the buyer page cannot form two opinions about the same row. That is the
 * exact failure the issue asks to avoid, and it is also why the precedence
 * (revoked → superseded → expired) is stated in one place only.
 */
export function effectiveQuoteStatus(
  quote: QuoteLifecycle,
  now: Date | string | number
): EffectiveQuoteStatus {
  return quoteUnusableReason(quote, now) ?? "active"
}

/**
 * A quote row with `status_effective` beside its stored `status`.
 *
 * Both fields travel, always. Dropping `status` would hide the fact an
 * operator may need — a superseded quote and an expired one are different
 * conversations — and replacing it in place would make the API disagree with
 * the column it is named after.
 */
export function withEffectiveStatus<T extends QuoteLifecycle>(
  quote: T,
  now: Date | string | number
): T & { status_effective: EffectiveQuoteStatus } {
  return { ...quote, status_effective: effectiveQuoteStatus(quote, now) }
}
