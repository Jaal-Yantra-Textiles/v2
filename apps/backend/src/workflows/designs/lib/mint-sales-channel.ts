import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { readHouseStore } from "../../production-runs/house-store"

/**
 * Which catalogue a design's minted product belongs in.
 *
 * 🔴 The fallback was `listStores({})[0].default_sales_channel_id`. On a
 * 14-store platform that is whichever row Postgres returned first — always the
 * core store — so a partner's design was minted into a catalogue belonging to
 * nobody who was selling it. The quote door was given an explicit
 * `sales_channel_id` to route around this (#1969); the admin approve route and
 * the run-output approval still fall through, so the lottery is live for them.
 *
 * Same family as the currency lottery (#2051) and the warehouse walk (#2053):
 * an unfiltered tenant read answered with row 0 and was right for exactly one
 * tenant.
 */

export type MintSalesChannelFailure =
  | "partner_has_no_store"
  | "partner_store_has_no_channel"
  | "ambiguous_partner_stores"
  | "no_house_store"
  | "house_store_has_no_channel"

export type ResolveMintSalesChannelResult = {
  sales_channel_id?: string
  /** Which rule answered: the caller, the owning partner, or the house store. */
  source?: "explicit" | "owner_partner" | "house_store"
  reason?: MintSalesChannelFailure
}

/**
 * PURE: the one store a partner sells through.
 *
 * More than one → null, for the same reason every other picker in this codebase
 * refuses: `[0]` would put a partner's product in whichever of their catalogues
 * came back first, and nothing downstream would report it.
 */
export function pickPartnerStore<T extends { id?: string | null }>(
  stores: T[] | null | undefined
): T | null {
  const rows = (stores ?? []).filter((s) => !!s?.id)
  return rows.length === 1 ? rows[0] : null
}

/**
 * Resolve the sales channel a design's product should be minted into.
 *
 * Order: the caller's explicit channel → the owning partner's store → the house
 * store. Never `stores[0]`. Returns a `reason` instead of a bare undefined so
 * the caller can say which rule ran out.
 */
export async function resolveMintSalesChannel(
  container: any,
  input: {
    explicitSalesChannelId?: string | null
    ownerPartnerId?: string | null
  }
): Promise<ResolveMintSalesChannelResult> {
  const explicit = String(input.explicitSalesChannelId ?? "").trim()
  if (explicit) {
    return { sales_channel_id: explicit, source: "explicit" }
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // A partner-owned design belongs in the partner's own catalogue.
  const ownerPartnerId = String(input.ownerPartnerId ?? "").trim()
  if (ownerPartnerId) {
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.id", "stores.default_sales_channel_id"],
      filters: { id: ownerPartnerId },
    })
    const stores = (partners?.[0]?.stores ?? []) as Array<{
      id?: string
      default_sales_channel_id?: string | null
    }>

    if (stores.length > 1) return { reason: "ambiguous_partner_stores" }
    if (!stores.length) return { reason: "partner_has_no_store" }

    const store = pickPartnerStore(stores)
    const channelId = store?.default_sales_channel_id
    if (!channelId) return { reason: "partner_store_has_no_channel" }
    return { sales_channel_id: String(channelId), source: "owner_partner" }
  }

  // Otherwise the platform's own catalogue. `readHouseStore` is the store that
  // is NOT a partner tenant, and returns null rather than guessing when that is
  // not a single unambiguous row.
  const house = await readHouseStore(container)
  if (!house?.id) return { reason: "no_house_store" }

  const storeService: any = container.resolve(Modules.STORE)
  const houseStore = await storeService.retrieveStore(house.id).catch(() => null)
  const channelId = houseStore?.default_sales_channel_id
  if (!channelId) return { reason: "house_store_has_no_channel" }

  return { sales_channel_id: String(channelId), source: "house_store" }
}
