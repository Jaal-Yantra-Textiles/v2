/**
 * Finding a partner by name over WhatsApp (#2106).
 *
 * The old lookup fetched `take: 5` partner rows with **no filter and no
 * ordering**, then matched names in JavaScript over just those five. There are
 * 31 partners on prod, so 26 of them could never be found — including every
 * partner we actually transact with. And the reply was:
 *
 *     Partner "sharlho" not found.
 *
 * which reads as *this partner does not exist*, not *I only looked at five
 * rows*. An admin on WhatsApp had no way to tell the difference.
 *
 * 🔴 THE LIE IS THE BUG, NOT THE LIMIT. Any lookup has a ceiling; what made
 * this dangerous is that hitting the ceiling was indistinguishable from a real
 * absence. So this module returns the reason as data — `truncated` says the
 * page was full, and the caller must say so rather than assert absence.
 *
 * Same family as the `take: 1` selectors (#1983): a bounded read with no
 * ordering, whose answer is presented as if it were the whole set.
 *
 * Pure on purpose — no container, no query — so the matching rule is testable
 * without a database, which is the half that was actually wrong.
 */

/** One page, generously larger than the partner table and still bounded. */
export const PARTNER_SEARCH_PAGE = 200

export type SearchablePartner = {
  id?: string | null
  name?: string | null
  handle?: string | null
}

export type PartnerSearchResult<T extends SearchablePartner> =
  /** Exactly one partner matched. */
  | { kind: "one"; partner: T }
  /**
   * Several matched. NOT resolved to a "best" one: picking silently is how a
   * lottery starts, and an admin asking about "raja" deserves to be told there
   * are two rather than handed one of them.
   */
  | { kind: "many"; partners: T[] }
  /**
   * Nothing matched. `truncated` is true when the page we searched was FULL —
   * meaning there may be partners we never looked at, and the caller must not
   * claim the partner does not exist.
   */
  | { kind: "none"; truncated: boolean }

const norm = (v: unknown): string =>
  typeof v === "string" ? v.trim().toLowerCase() : ""

/**
 * PURE: which partners match what the admin typed.
 *
 * An exact id, handle or name match wins outright — otherwise typing a short
 * handle that is also a substring of two longer names would be "ambiguous"
 * when the admin was in fact precise.
 */
export const searchPartners = <T extends SearchablePartner>(
  rows: T[],
  term: string,
  pageSize: number = PARTNER_SEARCH_PAGE
): PartnerSearchResult<T> => {
  const needle = norm(term)
  const all = Array.isArray(rows) ? rows : []
  const truncated = all.length >= pageSize

  if (!needle) {
    return { kind: "none", truncated }
  }

  const exact = all.filter(
    (p) =>
      norm(p.id) === needle ||
      norm(p.handle) === needle ||
      norm(p.name) === needle
  )
  if (exact.length === 1) return { kind: "one", partner: exact[0] }
  if (exact.length > 1) return { kind: "many", partners: exact }

  const partial = all.filter(
    (p) => norm(p.name).includes(needle) || norm(p.handle).includes(needle)
  )

  if (partial.length === 1) return { kind: "one", partner: partial[0] }
  if (partial.length > 1) return { kind: "many", partners: partial }

  return { kind: "none", truncated }
}

/** How many candidates we will name back before it stops being readable on a phone. */
const MAX_LISTED = 5

/**
 * What to say when several partners matched — the admin picks, we do not guess.
 */
export const describeAmbiguous = (
  partners: SearchablePartner[],
  term: string
): string => {
  const lines = partners
    .slice(0, MAX_LISTED)
    .map((p) => `• ${p.name || p.handle || p.id} — \`${p.handle || p.id}\``)
  const more =
    partners.length > MAX_LISTED
      ? `\n…and ${partners.length - MAX_LISTED} more.`
      : ""
  return `"${term}" matches ${partners.length} partners:\n${lines.join("\n")}${more}\n\nReply with the handle or id.`
}

/**
 * What to say when nothing matched.
 *
 * 🔴 The two sentences differ, and that difference IS the fix. Only the first
 * claims the partner does not exist; the second admits we did not see
 * everything, which is the honest answer when the page was full.
 */
export const describeNotFound = (term: string, truncated: boolean): string =>
  truncated
    ? `No match for "${term}" in the first ${PARTNER_SEARCH_PAGE} partners — there may be more I did not search. Try the exact handle or id.`
    : `Partner "${term}" not found.`
