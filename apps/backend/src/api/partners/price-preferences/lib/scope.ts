import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"

import { getPartnerFromAuthContext, tryGetPartnerStore } from "../../helpers"
import partnerRegionLink from "../../../../links/partner-region"

/**
 * Partner scoping for price preferences — the one pricing surface that cannot
 * be scoped by ownership alone.
 *
 * ## What was wrong
 *
 * These routes checked only "are you *a* partner". `GET` ran
 * `query.graph({ entity: "price_preferences", fields: ["*"] })` with **no
 * filters**, and the writes called `createPricePreferences(req.body)` /
 * `updatePricePreferences(id, body)` / the delete workflow with no ownership
 * check at all. Any partner could read, edit and delete every other partner's
 * tax-inclusivity setting — and the same routes are exposed to the partner AI
 * assistant as `write: true` MCP tools.
 *
 * ## Why scoping here is different
 *
 * A `price_preference` is keyed by `(attribute, value)` where attribute is
 * `currency_code` or `region_id`. **Neither has a partner dimension.**
 *
 * - `currency_code` is platform-wide by construction. Flipping tax-inclusivity
 *   for `inr` changes it for every store pricing in INR. There is no version of
 *   that write which is "yours", so it is refused outright.
 * - `region_id` is scopeable — but only when the region belongs to this partner
 *   and to NO other partner. On prod a single region backs roughly ten stores,
 *   so "linked to me" is not the same as "mine", and the shared case has to be
 *   refused too or the hole simply moves.
 *
 * Reads are wider than writes on purpose: a partner may legitimately need to
 * SEE the preference that governs their prices even when it is shared and they
 * must not change it.
 */

export type PricePreferenceScope = {
  /** Regions linked to this partner. */
  region_ids: string[]
  /** Regions linked to this partner and to no other partner. */
  exclusive_region_ids: string[]
  /** Currencies this partner's store supports, lower-cased. */
  currency_codes: string[]
}

export type PricePreferenceLike = {
  attribute?: string | null
  value?: string | null
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase()

/**
 * PURE: may this partner SEE this preference?
 *
 * Deliberately permissive relative to writability — a preference that governs
 * a partner's own prices is theirs to read even when it is shared.
 */
export function isPreferenceInScope(
  pref: PricePreferenceLike,
  scope: PricePreferenceScope
): boolean {
  const attribute = norm(pref.attribute)
  const value = pref.value ?? ""

  if (attribute === "region_id") {
    return scope.region_ids.includes(value)
  }
  if (attribute === "currency_code") {
    return scope.currency_codes.includes(norm(value))
  }
  // An attribute we do not model is not ours to show.
  return false
}

/**
 * PURE: may this partner CHANGE this preference, and if not, exactly why.
 *
 * The reason is returned rather than a bare boolean because every refusal here
 * is one a partner will reasonably want explained — "this is shared" and "this
 * is not yours" are different answers and deserve different copy.
 */
export function checkPreferenceWritable(
  pref: PricePreferenceLike,
  scope: PricePreferenceScope
): { writable: boolean; reason: string | null } {
  const attribute = norm(pref.attribute)
  const value = pref.value ?? ""

  if (attribute === "currency_code") {
    return {
      writable: false,
      reason:
        `A price preference on a currency applies to every store pricing in ${norm(value) || "that currency"}, ` +
        `not just yours, so it cannot be changed from a partner account. Set it per region instead, or ask an administrator.`,
    }
  }

  if (attribute === "region_id") {
    if (!scope.region_ids.includes(value)) {
      return {
        writable: false,
        reason: `Region ${value || "(none)"} is not one of yours.`,
      }
    }
    if (!scope.exclusive_region_ids.includes(value)) {
      return {
        writable: false,
        reason:
          `Region ${value} is shared with other partners, so changing its tax-inclusivity would change theirs too. ` +
          `Ask an administrator if this needs to move.`,
      }
    }
    return { writable: true, reason: null }
  }

  return {
    writable: false,
    reason: `Unsupported price-preference attribute "${pref.attribute ?? ""}".`,
  }
}

/** Throws NOT_ALLOWED with the specific reason, or returns cleanly. */
export function assertPreferenceWritable(
  pref: PricePreferenceLike,
  scope: PricePreferenceScope
): void {
  const { writable, reason } = checkPreferenceWritable(pref, scope)
  if (!writable) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      reason ?? "This price preference cannot be changed from a partner account."
    )
  }
}

/**
 * Resolve what this partner may see and change.
 *
 * Exclusivity is computed from the partner↔region link itself: a region is only
 * writable when this partner is the sole partner linked to it.
 */
export async function resolvePricePreferenceScope(
  authContext: { actor_id?: string | null } | undefined,
  container: MedusaContainer
): Promise<{ partner: any; scope: PricePreferenceScope }> {
  const partner = await getPartnerFromAuthContext(authContext, container)
  if (!partner) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "No partner associated with this account"
    )
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // Every partner↔region link, so we can tell "mine" from "mine alone".
  const { data: links } = await query.graph({
    entity: partnerRegionLink.entryPoint,
    fields: ["partner_id", "region_id"],
  })

  const regionIds: string[] = []
  const partnersByRegion = new Map<string, Set<string>>()
  for (const l of (links || []) as any[]) {
    if (!l?.region_id) continue
    if (!partnersByRegion.has(l.region_id)) {
      partnersByRegion.set(l.region_id, new Set())
    }
    if (l.partner_id) partnersByRegion.get(l.region_id)!.add(l.partner_id)
    if (l.partner_id === partner.id) regionIds.push(l.region_id)
  }

  const exclusiveRegionIds = regionIds.filter(
    (id) => (partnersByRegion.get(id)?.size ?? 0) === 1
  )

  // Currencies come from the partner's store; a storeless partner sees none
  // rather than everything.
  const { store } = await tryGetPartnerStore(authContext, container)
  let currencyCodes: string[] = []
  if (store?.id) {
    const { data: stores } = await query.graph({
      entity: "stores",
      fields: ["id", "supported_currencies.currency_code"],
      filters: { id: store.id },
    })
    currencyCodes = (((stores?.[0] as any)?.supported_currencies || []) as any[])
      .map((c) => norm(c?.currency_code))
      .filter(Boolean)
  }

  return {
    partner,
    scope: {
      region_ids: [...new Set(regionIds)],
      exclusive_region_ids: [...new Set(exclusiveRegionIds)],
      currency_codes: [...new Set(currencyCodes)],
    },
  }
}
