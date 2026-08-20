/**
 * The quoted-vs-live display rule — pure, so the page, the email and the tests
 * all read the same decision.
 *
 * ## Why the copy lives here and not in the storefront
 *
 * The non-binding disclaimer is the control that keeps a quote link from
 * reading as a binding offer. If the storefront wrote it, a theme edit could
 * remove it; if the email template wrote it, the two could drift and only one
 * would be wrong. It is returned by the backend, from this one file.
 *
 * ## Why "identical" collapses to a single number
 *
 * Two identical numbers under two headings reads as a bug, not as
 * reassurance. Show both only when they actually differ, or when the buyer has
 * moved the quantity/destination away from what was quoted — at which point
 * "what you were quoted" and "what you are looking at" are genuinely different
 * questions.
 */

export type QuoteMoney = {
  unit_amount: number
  subtotal: number
  freight: number
  landed_total: number
}

export type QuoteCompareInput = {
  /** Frozen at mint. Null when the quote predates a freeze (or freight was refused). */
  quoted: QuoteMoney | null
  /** Recomputed now. Null when the quote is expired or revoked — we do not price a dead link. */
  live: QuoteMoney | null
  /** True when the buyer has changed quantity or destination away from the quoted ones. */
  buyer_changed_inputs: boolean
  /** From `quoteUnusableReason`. */
  unusable_reason: "revoked" | "expired" | null
  /** Whole days to expiry, from `daysUntilExpiry`. */
  days_until_expiry: number | null
}

export type QuoteDisplayState =
  | "dead_link"
  | "expired_quoted_only"
  | "quoted_only"
  | "show_both"

export type QuoteCompareResult = {
  state: QuoteDisplayState
  /** Render the quoted column. */
  show_quoted: boolean
  /** Render the live column. */
  show_live: boolean
  /** Signed difference in landed total (live - quoted), when both exist. */
  landed_delta: number | null
  /** Headline for the page and the email subject line. */
  headline: string
  /** One-line explanation of what the buyer is looking at. */
  explanation: string
  /** The non-binding disclaimer. Always present except on a dead link. */
  disclaimer: string | null
  /** Amber expiry nudge, at 3 days or fewer. */
  expiry_notice: string | null
}

const DISCLAIMER =
  "This quote is an estimate, not a binding offer. Prices, freight and " +
  "availability are confirmed when the order is placed."

const amberAt = (days: number | null): string | null => {
  if (days === null) return null
  if (days === 0) return "This quote expires today."
  if (days <= 3) {
    return `This quote expires in ${days} day${days === 1 ? "" : "s"}.`
  }
  return null
}

export function compareQuote(input: QuoteCompareInput): QuoteCompareResult {
  const { quoted, live, buyer_changed_inputs, unusable_reason } = input

  if (unusable_reason === "revoked") {
    return {
      state: "dead_link",
      show_quoted: false,
      show_live: false,
      landed_delta: null,
      headline: "This quote is no longer available",
      explanation:
        "The partner who sent this quote has withdrawn it. Get in touch with them for a current one.",
      disclaimer: null,
      expiry_notice: null,
    }
  }

  if (unusable_reason === "expired") {
    // Deliberately no live number: recomputing one would look like an offer we
    // are still making. The record of what was said stays visible.
    return {
      state: "expired_quoted_only",
      show_quoted: quoted !== null,
      show_live: false,
      landed_delta: null,
      headline: "This quote has expired",
      explanation:
        "These are the figures as quoted. Ask the partner to re-send for current pricing and freight.",
      disclaimer: DISCLAIMER,
      expiry_notice: null,
    }
  }

  // Live-only: nothing was frozen (an older row, or freight was refused at
  // mint). The page is still useful; it just has nothing to compare against.
  if (!quoted && live) {
    return {
      state: "quoted_only",
      show_quoted: false,
      show_live: true,
      landed_delta: null,
      headline: "Your quote",
      explanation: "Current pricing and freight for the quantity shown.",
      disclaimer: DISCLAIMER,
      expiry_notice: amberAt(input.days_until_expiry),
    }
  }

  if (quoted && !live) {
    return {
      state: "quoted_only",
      show_quoted: true,
      show_live: false,
      landed_delta: null,
      headline: "Your quote",
      explanation: "The figures as quoted.",
      disclaimer: DISCLAIMER,
      expiry_notice: amberAt(input.days_until_expiry),
    }
  }

  if (!quoted && !live) {
    return {
      state: "quoted_only",
      show_quoted: false,
      show_live: false,
      landed_delta: null,
      headline: "Your quote",
      explanation: "Pricing for this quote is unavailable right now.",
      disclaimer: DISCLAIMER,
      expiry_notice: amberAt(input.days_until_expiry),
    }
  }

  const q = quoted as QuoteMoney
  const l = live as QuoteMoney
  const identical =
    q.unit_amount === l.unit_amount &&
    q.subtotal === l.subtotal &&
    q.freight === l.freight &&
    q.landed_total === l.landed_total

  if (identical && !buyer_changed_inputs) {
    return {
      state: "quoted_only",
      show_quoted: true,
      show_live: false,
      landed_delta: 0,
      headline: "Your quote",
      explanation: "Pricing and freight are unchanged since this quote was sent.",
      disclaimer: DISCLAIMER,
      expiry_notice: amberAt(input.days_until_expiry),
    }
  }

  return {
    state: "show_both",
    show_quoted: true,
    show_live: true,
    landed_delta: l.landed_total - q.landed_total,
    headline: "Your quote, and what it costs today",
    explanation: buyer_changed_inputs
      ? "You have changed the quantity or destination, so today's figures differ from the ones quoted."
      : "Pricing or freight has moved since this quote was sent.",
    disclaimer: DISCLAIMER,
    expiry_notice: amberAt(input.days_until_expiry),
  }
}
