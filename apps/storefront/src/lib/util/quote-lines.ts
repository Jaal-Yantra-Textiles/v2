/**
 * The buyer's dialled basket, carried in the URL (#1439 S13).
 *
 * ## Why the URL and not client state
 *
 * Every number on the quote page — each line's subtotal, the freight the
 * carrier rates for the new weight, the tax band the new goods value falls in,
 * the deposit — is computed by the backend against the basket it is given.
 * `GET /store/b2b/quotes/:token?lines=` re-prices the whole document. So the
 * quantity control moves the URL and lets the server answer; it does no price
 * arithmetic of its own.
 *
 * 🔴 That is not a style preference. A client-side `unit_amount × qty` would be
 * wrong the moment a quantity crosses a price-list tier, a carrier weight slab
 * or a tax threshold — and it would be wrong *quietly*, showing the buyer a
 * total the cart will not honour. There is exactly one thing on this page
 * allowed to price a basket, and it is not the browser.
 *
 * A second benefit falls out for free: the dialled basket is shareable and
 * survives a reload, which is what a procurement contact forwarding the link to
 * their finance team actually does.
 *
 * ## The wire form
 *
 * `?lines=variant_01ABC:40,variant_01DEF:12`
 *
 * Deliberately not JSON. A JSON array percent-encodes into an unreadable
 * ribbon in a link that gets pasted into emails and purchase orders; a
 * colon/comma pair survives it legibly. Medusa ids are `[A-Za-z0-9_]` so
 * neither separator can occur inside one. The backend speaks JSON, and
 * `retrieveQuote` does that translation at the boundary.
 */

export type DialledLine = { variant_id: string; quantity: number }

/** How Medusa joins option values into a variant title. */
const VARIANT_OPTION_SEPARATOR = " / "

/**
 * The part of a sibling variant's title that is not already true of the quoted
 * one — the label for an "Also made in" pill.
 *
 * On a real catalogue these titles are option joins that agree for most of
 * their length: `Pattern 1 - Blue/Mustard/Cream/Grey / HandSpun` beside
 * `Pattern 1 - Blue/Mustard/Cream/Grey / MilSpun`. Rendered whole they are ~45
 * characters each, so five of them wrap to one per line inside a table cell —
 * a vertical column of boxes — and the single word that distinguishes them sits
 * at the far end of each, past where the eye stops.
 *
 * So the segments the quoted variant already carries are dropped and what is
 * left is shown. The pill then says the only thing it is on the page to say.
 *
 * 🔑 Never returns empty. Two variants can differ on an option the title does
 * not spell out, and an empty pill would read as a rendering fault while
 * hiding a genuine alternative — so the full title is the fallback.
 */
export const otherVariantLabel = (
  quotedTitle: string | null | undefined,
  otherTitle: string | null | undefined
): string => {
  const other = String(otherTitle ?? "").trim()
  if (!other) {
    return "Another finish"
  }

  const quotedSegments = new Set(
    String(quotedTitle ?? "")
      .split(VARIANT_OPTION_SEPARATOR)
      .map((segment) => segment.trim())
      .filter(Boolean)
  )

  const distinguishing = other
    .split(VARIANT_OPTION_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !quotedSegments.has(segment))

  return distinguishing.length
    ? distinguishing.join(VARIANT_OPTION_SEPARATOR)
    : other
}

/**
 * Read the dial out of a search param.
 *
 * Total in its tolerance: a malformed pair is dropped, not thrown on. This
 * value arrives from a URL a buyer may have edited, truncated in an email
 * client, or had mangled by a link rewriter — none of which is worth a 500 on a
 * page whose entire job is to show someone a price. What survives parsing is
 * applied; the rest falls back to the quoted quantity, because the backend
 * re-prices from the quote's own lines and only overrides the variants it is
 * told about.
 *
 * Negative and fractional quantities are dropped rather than clamped: the
 * caller asked for something that cannot be manufactured, and silently
 * rounding it to a number they did not choose is how a buyer ends up ordering a
 * quantity nobody typed. Zero is kept — the backend treats it as "remove this
 * line", which is an ordinary thing to do to a multi-line quote.
 */
export const parseDialledLines = (
  param: string | string[] | undefined | null
): DialledLine[] => {
  const raw = Array.isArray(param) ? param[0] : param
  if (!raw) {
    return []
  }

  const seen = new Set<string>()
  const out: DialledLine[] = []

  for (const pair of raw.split(",")) {
    const idx = pair.lastIndexOf(":")
    if (idx <= 0) {
      continue
    }

    const variant_id = pair.slice(0, idx).trim()
    const rawQuantity = pair.slice(idx + 1).trim()

    /**
     * 🔴 The empty check is load-bearing, and is NOT covered by the numeric one
     * below it: `Number("")` is `0`, a perfectly valid integer — and the
     * backend reads a dialled 0 as "remove this line". So a link truncated at
     * the colon (`?lines=variant_a:2,variant_b:`) — which is exactly what an
     * email client wrapping a long URL produces — would have silently deleted a
     * product from the buyer's basket and re-priced the quote without it.
     * Caught by the round-trip test, never by a type checker.
     */
    if (!variant_id || !rawQuantity) {
      continue
    }

    const quantity = Number(rawQuantity)
    if (!Number.isInteger(quantity) || quantity < 0) {
      continue
    }
    // First mention wins, so a duplicated variant cannot make the page and a
    // re-read of the same URL disagree about what was asked for.
    if (seen.has(variant_id)) {
      continue
    }

    seen.add(variant_id)
    out.push({ variant_id, quantity })
  }

  return out
}

/** The inverse. Stable order in, stable order out — the link must not churn. */
export const serialiseDialledLines = (lines: DialledLine[]): string =>
  lines.map((l) => `${l.variant_id}:${l.quantity}`).join(",")

/**
 * The href for the page with one line moved to `quantity`.
 *
 * Built from the lines the SERVER priced, never from the incoming query string:
 * the rendered document is the source of truth for what the buyer is looking
 * at, so a stale or partial `?lines=` cannot leak into the next navigation.
 */
export const buildDialHref = ({
  countryCode,
  token,
  lines,
  variantId,
  quantity,
}: {
  countryCode: string
  token: string
  lines: DialledLine[]
  variantId: string
  quantity: number
}): string => {
  const next = lines.map((l) =>
    l.variant_id === variantId ? { ...l, quantity } : l
  )

  return `/${countryCode}/quotes/${encodeURIComponent(token)}?lines=${encodeURIComponent(
    serialiseDialledLines(next)
  )}`
}

/** The href back to the basket the partner actually quoted. */
export const buildQuotedHref = ({
  countryCode,
  token,
}: {
  countryCode: string
  token: string
}): string => `/${countryCode}/quotes/${encodeURIComponent(token)}`
