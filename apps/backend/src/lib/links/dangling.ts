/**
 * Link rows whose target is no longer visible (#1857).
 *
 * `query.graph` resolves a linked collection by joining the link table to the
 * target module. Where the target is gone it returns a **null in the array** —
 * not a shorter array, not an error. Every reader that maps, counts or
 * dereferences that array is therefore one dangling row away from either a
 * crash or a quiet over-count:
 *
 *   - `/admin/partners/:id/people` answered `{"people":[null,null,null,null],
 *     "count":4}` and took the whole partner detail page down.
 *   - `/admin/designs/:id/production-runs` splits a quantity across
 *     `linkedPartners.length` — a dangling row shrinks every real partner's
 *     share and creates a child run with `partner_id: undefined`.
 *
 * 🔴 "Gone" here means INVISIBLE, not absent. A soft-deleted target produces
 * exactly the same null as a hard-deleted one, and the first two sweeps of
 * #1857 missed that entirely: they asked whether the row EXISTS (`tgt.id IS
 * NULL`) when the question is whether `query.graph` can see it. Correcting
 * that took the prod count from 27 pairs to 46. Nothing downstream can tell
 * the two apart, and nothing downstream needs to.
 *
 * 🔴 The count is RETURNED, never swallowed. Dropping the nulls silently
 * trades a crash for "No people linked" rendered over four link rows, which is
 * the quieter half of the same lie. A caller that has somewhere to say so
 * should say so.
 */

export type LinkedRows<T> = {
  /** The members that actually resolved. Safe to map and dereference. */
  rows: T[]
  /** How many link rows pointed at something `query.graph` could not see. */
  dangling: number
}

/**
 * Split a linked collection into what resolved and how much did not.
 *
 * Accepts the raw field off a `query.graph` result — which may be undefined
 * (the entity has no such link), a single object, or an array with holes.
 */
export const linkedRows = <T extends Record<string, any>>(
  value: unknown
): LinkedRows<T> => {
  const all: unknown[] = Array.isArray(value)
    ? value
    : value == null
      ? []
      : [value]

  /*
   * 🔴 A plain non-null test, NOT `!!r.id`.
   *
   * The `id` version is the obvious one and it is wrong here: several callers
   * ask for a single column and nothing else — `fields: ["stores.
   * default_sales_channel_id"]` — so every resolved row would have been thrown
   * away as dangling and the count would have read as total loss. A dangling
   * link resolves to exactly `null`, which is all this needs to look for.
   */
  const rows = all.filter((r): r is T => !!r && typeof r === "object")

  return { rows, dangling: all.length - rows.length }
}

/** Just the rows, where the caller has nowhere to report the discrepancy. */
export const presentRows = <T extends Record<string, any>>(
  value: unknown
): T[] => linkedRows<T>(value).rows
