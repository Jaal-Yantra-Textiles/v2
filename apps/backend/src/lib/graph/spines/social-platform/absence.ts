/**
 * When does the model genuinely EXPECT a neighbour on a social platform? (#1855)
 *
 * 🔴 This spine asserts ONE fault, and the restraint is deliberate.
 *
 * The obvious marketing rules — a scheduled post whose time has passed, a post
 * marked `posted` with no `post_url`, a stalled campaign — are all plausible
 * and NONE of them could be exercised: the local database holds zero social
 * posts, zero publishing campaigns, zero leads and zero ad campaigns. A rule
 * that has never run against a real row is a guess with a test around it, and
 * shipping four of them onto a surface nobody can check is how a graph starts
 * crying wolf. They are deferred, with what was learned, rather than shipped
 * unverified.
 *
 * What IS here fires on 49 real rows.
 */

export type BindingLike = {
  id: string
  status?: string | null
  last_synced_at?: string | Date | null
  last_error?: string | null
}

/**
 * A binding that is switched on and has never brought anything back.
 *
 * `status = "active"` is what every screen reads to decide whether an
 * integration is connected, and it is set at creation — before a single sync
 * has run. So a binding that never worked at all is indistinguishable from one
 * syncing happily every hour.
 *
 * Measured: all 49 `search-console` bindings on the local database are
 * `active` with `last_synced_at` null and no `last_error` — connected by every
 * indication, and no data has ever come back from any of them.
 *
 * 🔴 `last_synced_at` null, NOT falsy. A date is an object; the guard has to
 * ask whether the field is set, and a `0`-like coercion trap here would silently
 * clear the whole rule.
 */
export const neverSynced = (bindings: BindingLike[]): BindingLike[] =>
  bindings.filter(
    (b) =>
      String(b.status) === "active" &&
      (b.last_synced_at === null || b.last_synced_at === undefined)
  )

/**
 * A binding carrying an error from its last attempt.
 *
 * Distinct from never-synced: this one HAS worked, and then stopped. Both are
 * `derived` — the neighbour exists and does not do its job — but they need
 * different sentences, because the fix differs.
 */
export const erroredBindings = (bindings: BindingLike[]): BindingLike[] =>
  bindings.filter(
    (b) => String(b.status) === "error" || !!String(b.last_error ?? "").trim()
  )
