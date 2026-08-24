/**
 * PURE: turn a quote list request's query string into module-service filters
 * and config (#1441).
 *
 * ## Why this is shared
 *
 * `/admin/quotes` and `/partners/quotes` are the same list with a different
 * scope — the admin may span partners, the partner is pinned to their own.
 * Everything else about paging, searching and sorting must behave identically,
 * because the two UIs are meant to feel like one product. Two hand-rolled
 * copies is how they drift.
 *
 * ## What this replaces
 *
 * Both routes previously returned the **entire** table and reported
 * `count = quotes.length`. `/partners/quotes` ignored `limit`/`offset` outright
 * even though `usePartnerQuotes` sent them, and the admin `DataTable` paged
 * client-side over everything ever minted. So both surfaces paged over a lie:
 * the pager moved, the count never meant anything, and a filter narrowed one
 * page rather than the set.
 *
 * 🔑 A caller-supplied sort field is checked against an allowlist rather than
 * passed through. `order` reaches the ORM, and "whatever the client sent" is
 * not a column name — an unknown field should be ignored, not handed onward.
 */

/** Sortable columns. Anything else is ignored in favour of the default. */
export const QUOTE_SORTABLE_FIELDS = [
  "created_at",
  "updated_at",
  "expires_at",
  "quoted_landed_total",
  "quoted_at",
  "status",
  "viewed_at",
  "last_viewed_at",
  "view_count",
] as const

/**
 * Newest first. A quote list is a work queue — the one just minted is the one
 * being talked about.
 */
export const QUOTE_DEFAULT_ORDER: Record<string, "ASC" | "DESC"> = {
  created_at: "DESC",
}

export const QUOTE_DEFAULT_LIMIT = 20
/** A ceiling, not a suggestion: `?limit=100000` is a table scan on request. */
export const QUOTE_MAX_LIMIT = 100

export type QuoteListQuery = {
  limit?: unknown
  offset?: unknown
  q?: unknown
  order?: unknown
  status?: unknown
  partner_id?: unknown
}

/**
 * The stored `status` clause for a requested EFFECTIVE status (#1510).
 *
 * `expired` is not a value of `PartnerQuote.status` — it is `active` plus a
 * date that has passed — so a list cannot simply pass the word through. It has
 * to be translated into a predicate, and it has to be translated HERE rather
 * than filtered out of the page afterwards: `count`, the pager and the filter
 * must all describe the same set. Post-filtering a page would give a table that
 * says "20 of 34" over eleven visible rows.
 *
 * 🔴 The expiry predicate is nested under `$and` rather than written as a
 * top-level `$or`, because the free-text search already owns `$or` and the two
 * would trample each other on `Object.assign` — silently, and in favour of
 * whichever ran last. Same pattern as `/admin/abandoned-carts`.
 *
 * A NULL `expires_at` is active forever, matching `quoteUnusableReason`, which
 * only calls a quote expired when it has a date AND that date has passed.
 */
export function buildQuoteStatusFilter(
  status: string,
  now: Date
): Record<string, unknown> {
  if (status === "expired") {
    return { status: "active", $and: [{ expires_at: { $lte: now } }] }
  }

  if (status === "active") {
    return {
      status: "active",
      $and: [{ $or: [{ expires_at: null }, { expires_at: { $gt: now } }] }],
    }
  }

  return { status }
}

export type BuiltQuoteListQuery = {
  filters: Record<string, unknown>
  config: {
    skip: number
    take: number
    order: Record<string, "ASC" | "DESC">
    relations: string[]
  }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  const text = String(raw ?? "").trim()
  // 🔑 An ABSENT param must fall back, not clamp. `Number("")` is 0 — finite —
  // so testing only `Number.isFinite` treated "no limit given" as "limit 0" and
  // clamped it to 1, silently serving one row per page on every default list.
  // Caught by its own unit test; it would have looked like a UI paging bug.
  if (!text) return fallback
  const n = Number(text)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.floor(n)))
}

/**
 * Parse `field:DIRECTION`, or a `-field` prefix for descending.
 *
 * Returns the default for anything unrecognised rather than throwing: a
 * malformed sort is not worth failing a list over, and silently ordering by
 * something the caller did not ask for is less harmful than a 400 on a page
 * load.
 */
export function parseQuoteOrder(raw: unknown): Record<string, "ASC" | "DESC"> {
  const value = String(raw ?? "").trim()
  if (!value) return { ...QUOTE_DEFAULT_ORDER }

  let field = value
  let direction: "ASC" | "DESC" = "ASC"

  if (value.includes(":")) {
    const [f, d] = value.split(":")
    field = (f || "").trim()
    direction = String(d || "").trim().toUpperCase() === "DESC" ? "DESC" : "ASC"
  } else if (value.startsWith("-")) {
    field = value.slice(1).trim()
    direction = "DESC"
  }

  if (!(QUOTE_SORTABLE_FIELDS as readonly string[]).includes(field)) {
    return { ...QUOTE_DEFAULT_ORDER }
  }

  return { [field]: direction }
}

/**
 * The free-text clause.
 *
 * Matches the three things a human actually remembers about a quote: who it
 * went to, the company on it, and the person's name. Deliberately NOT the
 * token or its hash — a quote must not be findable by anything resembling its
 * credential, and an operator searching by token is a workflow we do not want
 * to make easy.
 */
export function buildQuoteSearchFilter(raw: unknown): Record<string, unknown> | null {
  const q = String(raw ?? "").trim()
  if (!q) return null

  const like = { $ilike: `%${q}%` }
  return {
    $or: [
      { email_sent_to: like },
      { recipient_company: like },
      { recipient_name: like },
    ],
  }
}

export function buildQuoteListQuery(
  query: QuoteListQuery,
  /** Filters the caller pins and the client cannot override — e.g. the partner's own id. */
  scoped: Record<string, unknown> = {},
  /** Passed in so `status=active|expired` stays deterministic under test. */
  now: Date = new Date()
): BuiltQuoteListQuery {
  const take = clampInt(query.limit, QUOTE_DEFAULT_LIMIT, 1, QUOTE_MAX_LIMIT)
  const skip = clampInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER)

  const filters: Record<string, unknown> = { ...scoped }

  const status = String(query.status ?? "").trim()
  if (status) {
    const clause = buildQuoteStatusFilter(status, now)
    // `$and` may already be pinned by the caller; intersect rather than replace.
    const and = clause.$and as unknown[] | undefined
    delete clause.$and
    Object.assign(filters, clause)
    if (and) {
      filters.$and = [...((filters.$and as unknown[]) ?? []), ...and]
    }
  }

  // Only honoured when the caller did not already pin it. A partner listing
  // their own quotes must never be able to widen the scope by query string.
  const partnerId = String(query.partner_id ?? "").trim()
  if (partnerId && scoped.partner_id === undefined) {
    filters.partner_id = partnerId
  }

  const search = buildQuoteSearchFilter(query.q)
  if (search) Object.assign(filters, search)

  return {
    filters,
    config: {
      skip,
      take,
      order: parseQuoteOrder(query.order),
      /**
       * 🔴 The lines are the basket, and both list tables render "N lines · M
       * units" from them. Without this relation the field is simply absent, so
       * every row read "0 lines · 0 units" — a quote that looks empty, on the
       * one screen a partner uses to check what they sent.
       *
       * It is a join over one page of rows, not a per-row query. The alternative
       * — counting server-side into two scalars — hides the basket from every
       * other consumer of this list to save bytes nobody is short of.
       */
      relations: ["lines"],
    },
  }
}
