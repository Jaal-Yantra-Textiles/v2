import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Where a partner's goods live — one implementation, two callers.
 *
 * 🔴 This logic existed TWICE, and the copy is the story.
 *
 * `resolvePartnerLocationStep` (banking finished goods at completion) and
 * `resolveRunGoodsLocation` (picking a goods-transfer's origin) each walked
 * `partner → stores[0] → default_sales_channel_id → sales_channels →
 * stock_locations[0]` independently. Both failed to `undefined` at every hop
 * with no log. Measured on prod 2026-09-14: **17 of 30 partners have no store**,
 * so both answered nothing for all of them — completion banked goods nowhere,
 * and a transfer could not say where the goods were coming from.
 *
 * Fixing one copy and not the other would have left the two disagreeing about
 * the same physical warehouse, which is worse than both being wrong in the same
 * way. So the resolution lives here and both call it. #2053
 */

/** Why a partner's location could not be resolved — names the hop that broke. */
export type PartnerLocationFailure =
  | "no_partner"
  | "no_link_and_no_store"
  | "store_has_no_sales_channel"
  | "sales_channel_has_no_location"
  | "ambiguous_linked_locations"

export type ResolvePartnerLocationResult = {
  location_id?: string
  /** "link" when the typed partner→location link answered, "store_chain" for the legacy walk. */
  source?: "link" | "store_chain"
  reason?: PartnerLocationFailure
  /** Every location the typed link returned — populated when the answer is ambiguous. */
  candidate_location_ids?: string[]
}

/**
 * PURE: the one warehouse a partner banks goods at.
 *
 * Exactly one → that one. None → null. **More than one → null**, deliberately:
 * a partner with two warehouses has a real question attached ("which one?") and
 * `[0]` answers it with whichever row the database happened to return first.
 * That is the same selector shape that made `stores[0]` denominate 13 tenants in
 * the wrong currency (#2051); it must not be reintroduced for physical stock,
 * where the cost of being wrong is goods banked in a city they are not in.
 */
export function pickPartnerLocation(
  locations: Array<{ id?: string | null } | null> | null | undefined
): { id: string } | null {
  const ids = (locations ?? [])
    .map((l) => l?.id)
    .filter((id): id is string => !!id)
  const unique = Array.from(new Set(ids))
  return unique.length === 1 ? { id: unique[0] } : null
}

/**
 * Resolve where a partner's finished goods are banked.
 *
 * Asks the typed `partner → stock_location` link first; the legacy
 * store→channel walk remains as the fallback for partners wired the old way.
 * Every hop that fails says so, both in the returned `reason` and in the log —
 * silence at every hop is what let this go unnoticed for months.
 *
 * See `links/partner-stock-location.ts`.
 */
export async function resolvePartnerLocation(
  container: any,
  partnerId: string | null | undefined
): Promise<ResolvePartnerLocationResult> {
  if (!partnerId) return { reason: "no_partner" }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const log: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  // 1. The typed link — the partner states its warehouse directly.
  let linkedLocations: Array<{ id?: string | null }> = []
  try {
    const { data: linked } = await query.graph({
      entity: "partners",
      fields: ["stock_locations.id"],
      filters: { id: partnerId },
    })
    linkedLocations = linked?.[0]?.stock_locations || []
  } catch {
    // The link may not be migrated yet in an older environment. Fall through to
    // the legacy chain rather than failing the caller outright.
    linkedLocations = []
  }

  const linkedPick = pickPartnerLocation(linkedLocations)
  if (linkedPick) {
    return { location_id: linkedPick.id, source: "link" }
  }

  if (linkedLocations.length > 1) {
    const ids = linkedLocations.map((l) => l?.id).filter(Boolean) as string[]
    log?.error(
      `[resolve-partner-location] partner ${partnerId} is linked to ${ids.length} stock locations ` +
        `(${ids.join(", ")}) — refusing to guess which one holds the goods. ` +
        `Unlink all but one, or pass an explicit location.`
    )
    return { reason: "ambiguous_linked_locations", candidate_location_ids: ids }
  }

  // 2. Legacy chain, for partners wired before the link existed.
  const { data: partners } = await query.graph({
    entity: "partners",
    fields: ["stores.default_sales_channel_id"],
    filters: { id: partnerId },
  })

  const stores = partners?.[0]?.stores || []
  if (!stores.length) {
    log?.error(
      `[resolve-partner-location] partner ${partnerId}: no linked stock location AND no store. ` +
        `Nowhere to bank finished goods. Link a stock location to this partner ` +
        `(maintenance job: backfill-partner-stock-locations).`
    )
    return { reason: "no_link_and_no_store" }
  }

  const scId = stores[0]?.default_sales_channel_id
  if (!scId) {
    log?.error(
      `[resolve-partner-location] partner ${partnerId}: store has no default sales channel. ` +
        `Link a stock location to the partner directly instead.`
    )
    return { reason: "store_has_no_sales_channel" }
  }

  const { data: channels } = await query.graph({
    entity: "sales_channels",
    fields: ["stock_locations.id"],
    filters: { id: scId },
  })

  const chainPick = pickPartnerLocation(channels?.[0]?.stock_locations || [])
  if (!chainPick) {
    log?.error(
      `[resolve-partner-location] partner ${partnerId}: sales channel ${scId} resolves to ` +
        `no single stock location. Link a stock location to the partner directly.`
    )
    return { reason: "sales_channel_has_no_location" }
  }

  return { location_id: chainPick.id, source: "store_chain" }
}
