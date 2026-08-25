/**
 * The quote email's payload (#1420).
 *
 * PURE, and separate from the workflow that sends it, because every one of
 * these fields is a claim made to a buyer about a commercial commitment and
 * each has a wrong answer that reads perfectly well:
 *
 * - a landed total of `0` where the quote could not price one,
 * - an expiry this email computed rather than the one the price list enforces,
 * - a greeting addressed to nobody.
 *
 * A pure builder is the only way those get asserted without standing up a
 * notification provider.
 */

/** What the template's `variables` block declares. Nothing more, nothing less. */
export type QuoteEmailData = {
  recipient_name: string
  partner_name: string
  quote_url: string
  landed_total: string
  destination: string
  line_count: number
  /**
   * The number of PIECES quoted, summed across every line (#1538 follow-up).
   *
   * 🔴 Added because `line_count` was being rendered as one. Both quote emails
   * said "your quote for {{line_count}} item(s)", and `line_count` is
   * `lines.length` — so a single line of 29 scarves announced itself as "1
   * item(s)", and Marcha's six-line quote of ten pieces as "6". The number was
   * right for a question nobody asked and wrong for the one the buyer reads.
   *
   * Both are kept. A buyer wants the pieces; the line count still says how the
   * basket is broken up, and templates already reference it.
   */
  total_quantity: number
  expires_on: string
  current_year: number
}

/**
 * PURE: how many pieces this quote is for.
 *
 * 🔑 Non-numeric and negative quantities are SKIPPED rather than coerced. A
 * `Number(undefined)` is `NaN`, and one bad line would otherwise turn the whole
 * count into "NaN item(s)" in a buyer's inbox — a wrong number that at least
 * announces itself, unlike the one this replaces, but still not something to
 * send. A line we cannot read contributes nothing and the rest still counts.
 */
export function totalQuotedQuantity(
  lines: Array<{ quantity?: unknown }> | null | undefined
): number {
  let total = 0
  for (const line of lines ?? []) {
    const quantity = Number(line?.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    total += quantity
  }
  return total
}

/**
 * A currency amount as a buyer should read it.
 *
 * Fixed `en-US` rather than the ambient locale: this runs on a server whose
 * locale is an accident of its container, and a quote that formats differently
 * depending on which task rendered it is not evidence of anything.
 */
export function formatQuoteMoney(
  amount: number | null | undefined,
  currencyCode: string | null | undefined
): string | null {
  if (amount === null || amount === undefined) return null
  const value = Number(amount)
  if (!Number.isFinite(value)) return null

  const currency = String(currencyCode ?? "").trim().toUpperCase()
  if (!currency) return null

  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
      value
    )
  } catch {
    // An unknown ISO code must not cost the buyer their link.
    return `${value} ${currency}`
  }
}

/** "Berlin, Germany" · "Germany" · "DE" — the most specific thing we can say. */
export function formatQuoteDestination(input: {
  city?: string | null
  countryCode?: string | null
}): string {
  const city = String(input.city ?? "").trim()
  const code = String(input.countryCode ?? "").trim().toUpperCase()

  let country = code
  if (code.length === 2) {
    try {
      country =
        new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code
    } catch {
      country = code
    }
  }

  if (city && country) return `${city}, ${country}`
  return city || country || "your destination"
}

/** The expiry the quote was minted with, never one recomputed here. */
export function formatQuoteExpiry(expiresAt: Date | string | null | undefined): string | null {
  if (!expiresAt) return null
  const date = new Date(expiresAt as any)
  if (Number.isNaN(date.getTime())) return null

  try {
    return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/**
 * PURE: everything the template needs, from the row that was just frozen.
 *
 * 🔴 `landed_total` falls back to a phrase, never to a number. `Number(null)`
 * is `0` and `0` formats as a perfectly convincing "₹0.00" — this system has
 * already shipped bulk orders free once from a zero nobody questioned
 * (#1430). An unpriced quote must say it has no total here, and let the page
 * be the place the buyer finds out why.
 */
export function buildQuoteEmailData(input: {
  quote: {
    recipient_name?: string | null
    recipient_company?: string | null
    quoted_landed_total?: number | null
    currency_code?: string | null
    destination_city?: string | null
    destination_country_code?: string | null
    expires_at?: Date | string | null
  }
  partnerName?: string | null
  quoteUrl: string
  lineCount: number
  /** Pieces across every line — see `total_quantity` on the payload type. */
  totalQuantity: number
  now: Date
}): QuoteEmailData {
  const q = input.quote

  return {
    // A company is a worse greeting than a person and a better one than
    // "Hi ,". Never an empty string: the salutation is the first line.
    recipient_name:
      String(q.recipient_name ?? "").trim() ||
      String(q.recipient_company ?? "").trim() ||
      "there",
    partner_name: String(input.partnerName ?? "").trim() || "Jaal Yantra Textiles",
    quote_url: input.quoteUrl,
    landed_total:
      formatQuoteMoney(q.quoted_landed_total ?? null, q.currency_code ?? null) ??
      "Shown on your quote",
    destination: formatQuoteDestination({
      city: q.destination_city ?? null,
      countryCode: q.destination_country_code ?? null,
    }),
    line_count: input.lineCount,
    total_quantity: input.totalQuantity,
    expires_on: formatQuoteExpiry(q.expires_at ?? null) ?? "the date shown on your quote",
    current_year: input.now.getUTCFullYear(),
  }
}
