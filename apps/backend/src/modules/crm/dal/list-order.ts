/**
 * How a CRM list says what it wants sorted (#1551).
 *
 * ## Why one owner
 *
 * Ordering has to be understood in THREE places — the admin route that accepts
 * it, the proxy that serialises it onto the wire, and the node that turns it
 * back into a repository config. Declared separately they drift, and a drift
 * here is silent: the node treats every query param it does not recognise as an
 * equality FILTER, so a spelling the node has not learned does not merely fail
 * to sort, it filters on a column that does not exist.
 *
 * ## The wire format
 *
 * `order=-created_at` (descending) or `order=created_at` (ascending) — one
 * field, the same shape Medusa's own list routes use, so nobody has to learn a
 * second vocabulary for `sort_by` + `sort_dir`.
 */

export type ListOrder = Record<string, "ASC" | "DESC">

/** `-created_at` → `{ created_at: "DESC" }`. Null for anything unusable. */
export const parseListOrder = (
  raw: string | null | undefined,
  allowed: readonly string[]
): ListOrder | null => {
  if (!raw || typeof raw !== "string") return null

  const trimmed = raw.trim()
  if (!trimmed) return null

  const descending = trimmed.startsWith("-")
  const field = descending ? trimmed.slice(1) : trimmed

  /**
   * 🔴 Allowlisted, not merely non-empty. The field reaches a repository query
   * verbatim, and an arbitrary caller-supplied column name is not something to
   * hand to one.
   */
  if (!allowed.includes(field)) return null

  return { [field]: descending ? "DESC" : "ASC" }
}

/** `{ created_at: "DESC" }` → `-created_at`, for the wire. */
export const serializeListOrder = (
  order: ListOrder | null | undefined
): string | null => {
  if (!order) return null

  const entries = Object.entries(order)
  if (entries.length !== 1) return null

  const [field, direction] = entries[0]
  if (!field) return null

  return String(direction).toUpperCase() === "DESC" ? `-${field}` : field
}

/**
 * The columns a CRM collection may be ordered by.
 *
 * Deliberately narrow: these exist on every CRM model, and widening it is a
 * decision to make per collection rather than by accident.
 */
export const CRM_ORDERABLE_FIELDS = ["created_at", "updated_at"] as const
