import type { MedusaContainer } from "@medusajs/framework/types"

import { resolvePartnerLocation } from "../../../workflows/production-runs/lib/partner-location"
import { tryGetPartnerStore } from "../helpers"

/**
 * The stock location a partner's portal treats as THEIRS (#2286) — what their
 * inventory screen lists, and where deliveries to them are "incoming".
 *
 * 1. Their store's default location, exactly as the inventory screen read it
 *    before, so a partner with a store sees no change.
 * 2. Otherwise the typed partner → stock_location link (#2053) via
 *    `resolvePartnerLocation`. 17 of 30 partners have no store; before this they
 *    saw an empty inventory however much sat in their warehouse (Ksaman).
 *
 * An ambiguous link (two warehouses) resolves to nothing, deliberately — the
 * caller shows an empty state rather than one warehouse picked at random.
 */
export async function resolvePartnerHomeLocation(
  authContext: { actor_id?: string | null } | undefined,
  container: MedusaContainer
): Promise<{ partner: any; location_id: string | null; source: "store" | "link" | null }> {
  const { partner, store } = await tryGetPartnerStore(authContext, container)
  if (store?.default_location_id) {
    return { partner, location_id: String(store.default_location_id), source: "store" }
  }
  const resolved = await resolvePartnerLocation(container, partner?.id)
  if (resolved.location_id) {
    return { partner, location_id: resolved.location_id, source: "link" }
  }
  return { partner, location_id: null, source: null }
}
