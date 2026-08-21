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
  now: Date
): "revoked" | "superseded" | "expired" | null {
  if (quote.status === "revoked") return "revoked"
  // Checked before expiry: a superseded quote is usually still inside its own
  // TTL, and "a newer quote replaced this" is the more useful thing to say than
  // "this expired" — the buyer has somewhere to go.
  if (quote.status === "superseded") return "superseded"
  if (
    quote.expires_at &&
    new Date(quote.expires_at).getTime() <= now.getTime()
  ) {
    return "expired"
  }
  return null
}

export function isQuoteUsable(quote: QuoteLifecycle, now: Date): boolean {
  return quoteUnusableReason(quote, now) === null
}

/** Whole days until expiry, floored at 0. Drives the amber "expiring" state. */
export function daysUntilExpiry(
  quote: QuoteLifecycle,
  now: Date
): number | null {
  if (!quote.expires_at) return null
  const ms = new Date(quote.expires_at).getTime() - now.getTime()
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)))
}
