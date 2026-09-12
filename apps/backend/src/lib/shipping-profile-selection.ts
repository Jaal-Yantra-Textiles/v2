/**
 * Which shipping profile does a thing belong to? — answered ONCE (#1983).
 *
 * ## Why this is a shared rule rather than two local ones
 *
 * Medusa gates fulfillment AND checkout on
 * `product.shipping_profile.id === shippingOption.shipping_profile_id`. Two
 * callers pick a profile — the product backfill job and store provisioning —
 * and if they ever disagree the symptom is not a crash. It is *"The shipping
 * option you have selected don't allow fulfillment of this item"* on a real
 * order, days later, with nothing pointing back at the choice that caused it.
 * That is the same failure that opened #1982.
 *
 * ## Why `take: 1` was wrong
 *
 * Store provisioning read `listShippingProfiles({}, { take: 1 })` — no filter,
 * no ordering — and used the result for all ten of a new store's shipping
 * options. With exactly one profile in the database that is correct by
 * ACCIDENT. The moment a second profile exists (which #1983 exists to create)
 * it becomes whichever row Postgres happened to return, per store, silently.
 *
 * Same family as `stores[0]` on a 13-tenant table, which made a store's
 * currency a lottery, and as the `take: 1` design-link read that handed
 * production the design a customer was no longer getting. A defect that fires
 * on SOME rows is a selector bug.
 *
 * ## The rule
 *
 * An explicit id wins, and must exist. Otherwise the single `type: "default"`
 * profile. Otherwise — only when there is exactly one profile in total — that
 * one. Otherwise `null`: the caller must fail loudly rather than guess, because
 * guessing is precisely what this replaces.
 */

/**
 * PURE: pick the profile to use. Returns `null` when the choice is ambiguous.
 *
 * 🔑 `null` is not "none available" — it is "more than one plausible answer and
 * nobody said which". Treat it as an error, never as a default.
 */
export function pickTargetProfileId(
  profiles: any[],
  explicitId?: string
): string | null {
  if (explicitId) {
    return profiles.some((p) => p?.id === explicitId) ? explicitId : null
  }
  const defaults = profiles.filter((p) => p?.type === "default")
  if (defaults.length === 1) return defaults[0].id
  if (defaults.length === 0 && profiles.length === 1) return profiles[0].id
  return null
}

/** The message a caller should raise when the pick came back ambiguous. */
export function describeAmbiguousProfilePick(
  profiles: any[],
  explicitId?: string
): string {
  if (explicitId) return `Shipping profile ${explicitId} not found`
  const defaults = profiles.filter((p) => p?.type === "default").length
  return (
    `Could not pick a shipping profile unambiguously: ${profiles.length} profile(s), ` +
    `${defaults} of type "default". Pass an explicit profile id.`
  )
}
