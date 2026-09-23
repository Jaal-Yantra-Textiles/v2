import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"

import { resolveCoreLocationIds } from "../workflows/consumption-logs/lib/apply-to-inventory"
import { readHouseStore } from "../workflows/production-runs/house-store"
import {
  PARTNER_SHIPPING_PROFILE_NAME,
  PARTNER_SHIPPING_PROFILE_TYPE,
  describeAmbiguousProfilePick,
  pickPartnerProfileId,
  pickTargetProfileId,
  shippingSideForLocation,
  shippingSideForProduct,
  type ShippingSide,
} from "./shipping-profile-selection"

/**
 * #1983 — container-side resolution of the two shipping profiles. The rules
 * themselves are PURE and live in `shipping-profile-selection.ts`; this file
 * only reads and (for the partner profile) creates.
 */

/**
 * The partner profile's id, creating it the first time it is needed.
 *
 * Creating on demand rather than in a migration keeps a fresh test database
 * and a brand-new deployment working the same way as prod: the first partner
 * store provisioned makes it.
 */
export async function ensurePartnerShippingProfileId(
  container: any
): Promise<string> {
  const fulfillment: any = container.resolve(Modules.FULFILLMENT)
  const profiles = (await fulfillment.listShippingProfiles({})) || []
  const existing = pickPartnerProfileId(profiles)
  if (existing) return existing

  const created = await fulfillment.createShippingProfiles({
    name: PARTNER_SHIPPING_PROFILE_NAME,
    type: PARTNER_SHIPPING_PROFILE_TYPE,
  })
  return Array.isArray(created) ? created[0].id : created.id
}

/**
 * The house profile's id — the single `type: "default"` profile.
 *
 * 🔴 The partner profile is removed from the candidates FIRST. Without that,
 * a database whose only profile is the partner one (a fresh test DB after the
 * first partner store) would satisfy `pickTargetProfileId`'s "exactly one
 * profile" fallback and hand the PARTNER profile back as the house one.
 */
export async function resolveHouseShippingProfileId(
  container: any
): Promise<string> {
  const fulfillment: any = container.resolve(Modules.FULFILLMENT)
  const partnerId = await ensurePartnerShippingProfileId(container)
  const candidates = (
    (await fulfillment.listShippingProfiles({})) || []
  ).filter((p: any) => p?.id !== partnerId)

  const picked = pickTargetProfileId(candidates)
  if (picked) return picked

  if (candidates.length === 0) {
    const created = await fulfillment.createShippingProfiles({
      name: "Default",
      type: "default",
    })
    return Array.isArray(created) ? created[0].id : created.id
  }
  throw new MedusaError(
    MedusaError.Types.INVALID_DATA,
    describeAmbiguousProfilePick(candidates)
  )
}

export async function resolveShippingProfileIdForSide(
  container: any,
  side: ShippingSide
): Promise<string> {
  return side === "partner"
    ? ensurePartnerShippingProfileId(container)
    : resolveHouseShippingProfileId(container)
}

/**
 * The house store's default sales channel, or `null` when the house store
 * cannot be told apart (see `readHouseStore`). Callers treat `null` as
 * "cannot decide", never as "not the house".
 */
export async function resolveHouseSalesChannelId(
  container: any
): Promise<string | null> {
  const house = await readHouseStore(container)
  if (!house?.id) return null
  const storeService: any = container.resolve(Modules.STORE)
  const [store] = await storeService.listStores({ id: house.id })
  return store?.default_sales_channel_id ?? null
}

/**
 * A per-location profile picker for code that creates options across many
 * locations at once (the shipping backfill jobs). The side comes from
 * `location_ownership.is_core`: our building → house profile, anyone else's →
 * partner profile. Reads once, then answers from memory.
 */
export async function makeShippingProfileForLocation(
  container: any
): Promise<(locationId: string | null | undefined) => Promise<string>> {
  const { coreLocationIds } = await resolveCoreLocationIds(container)
  const cache = new Map<ShippingSide, string>()
  return async (locationId) => {
    const side = shippingSideForLocation(locationId, coreLocationIds)
    if (!cache.has(side)) {
      cache.set(side, await resolveShippingProfileIdForSide(container, side))
    }
    return cache.get(side)!
  }
}

/**
 * The profile a NEW product should carry, from the channels it is sold in.
 * Every product creator that can land a product in a partner channel calls
 * this, so no path mints a partner product on the house profile — which under
 * the strict split would make it impossible to ship with the partner's options.
 *
 * ⚠️ When the house channel cannot be resolved this falls back to the PARTNER
 * profile and says so, rather than refusing: refusing would stop every product
 * create on the platform the moment the house store is ambiguous (the #2100
 * outage shape), while a misplaced profile is repairable afterwards by the
 * `split-partner-shipping-profile` job.
 */
export async function resolveProductShippingProfileId(
  container: any,
  salesChannelIds: string[]
): Promise<string> {
  const houseChannelId = await resolveHouseSalesChannelId(container)
  let side = shippingSideForProduct(salesChannelIds, houseChannelId)
  if (!side) {
    const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
    logger.warn(
      "[shipping-profile] house sales channel unresolved — using the partner " +
        "shipping profile. Run split-partner-shipping-profile once the house " +
        "store is fixed."
    )
    side = "partner"
  }
  return resolveShippingProfileIdForSide(container, side)
}
