/**
 * @file Pure helpers for building free-text (`q`) list filters.
 * @module lib/list-search-filters
 *
 * Mirrors the established admin pattern (e.g. `admin/persons/partner/route.ts`,
 * `admin/google-merchant/accounts/route.ts`): a global `q` query param expands
 * into a DB-level `$or` of case-insensitive `$ilike` clauses across the given
 * fields. Doing the filter at the query layer (not in-app) keeps pagination and
 * the returned `count` correct.
 */

/**
 * Build a `$or` / `$ilike` search clause for a free-text `q` over the given
 * fields. Returns an empty object when `q` is blank or no fields are supplied,
 * so the result can be spread directly into an existing `filters` object:
 *
 *   const filters = { status, ...buildQSearchFilter(q, ["name", "handle"]) }
 *
 * @param q - The raw free-text search term (may be undefined/null/blank).
 * @param fields - Entity fields to match against (case-insensitive contains).
 * @returns `{ $or: [...] }` when active, otherwise `{}`.
 */
export const buildQSearchFilter = (
  q: string | undefined | null,
  fields: string[]
): Record<string, any> => {
  const trimmed = typeof q === "string" ? q.trim() : ""
  if (!trimmed || !Array.isArray(fields) || fields.length === 0) {
    return {}
  }

  return {
    $or: fields.map((field) => ({ [field]: { $ilike: `%${trimmed}%` } })),
  }
}
