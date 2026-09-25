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

/**
 * #1983 — partner shipping lives on its OWN profile.
 *
 * Founder's decision (2026-09-23): a STRICT split. A house option ships house
 * products only; a partner option ships partner products only. Medusa enforces
 * it for us once the two sides sit on different profiles — both
 * `validateShippingStep` (checkout) and create-fulfillment compare
 * `product.shipping_profile.id` with `shippingOption.shipping_profile_id`.
 *
 * The profile is found by NAME and type. There is no typed "role" column on a
 * shipping profile, and a name is at least visible to whoever renames it.
 */
export const PARTNER_SHIPPING_PROFILE_NAME = "Partner Shipping Profile"
export const PARTNER_SHIPPING_PROFILE_TYPE = "custom"

/**
 * PURE: the partner profile among `profiles`.
 *
 * `null` means none exists yet (the caller may create it). More than one is an
 * error, not a choice — the same refusal as `pickTargetProfileId`, for the same
 * reason: picking one of two would split partner options across them.
 */
export function pickPartnerProfileId(profiles: any[]): string | null {
  const matches = profiles.filter(
    (p) =>
      p?.name === PARTNER_SHIPPING_PROFILE_NAME &&
      p?.type === PARTNER_SHIPPING_PROFILE_TYPE
  )
  if (matches.length > 1) {
    throw new Error(
      `Found ${matches.length} shipping profiles named "${PARTNER_SHIPPING_PROFILE_NAME}" ` +
        `(${matches.map((p) => p.id).join(", ")}). Remove the duplicates; ` +
        `partner options must all share one profile.`
    )
  }
  return matches[0]?.id ?? null
}

export type ShippingSide = "house" | "partner"

/**
 * PURE: which side a PRODUCT belongs to — decided by where it is SOLD, not by
 * who made it.
 *
 * 🔴 "Made by a partner" is the wrong test: an artisan lists onto the house
 * channel through the partner workflow (`isCoreChannelListing`), and that
 * product is sold and shipped by the house. So: on the house channel → house;
 * otherwise → partner.
 *
 * `null` when the house channel is unknown — the caller must refuse, never
 * guess, because a wrong guess makes the product uncheckoutable.
 */
export function shippingSideForProduct(
  salesChannelIds: string[],
  houseChannelId: string | null | undefined
): ShippingSide | null {
  if (!houseChannelId) return null
  return salesChannelIds.includes(houseChannelId) ? "house" : "partner"
}

/**
 * PURE: which side a SHIPPING OPTION belongs to — decided by whose building it
 * ships from (`location_ownership.is_core`). An option with no location
 * (a zone with no fulfillment set location) is left to the house: it is not a
 * partner's, and moving it would be a guess.
 */
export function shippingSideForLocation(
  locationId: string | null | undefined,
  coreLocationIds: ReadonlySet<string>
): ShippingSide {
  if (!locationId) return "house"
  return coreLocationIds.has(locationId) ? "house" : "partner"
}
