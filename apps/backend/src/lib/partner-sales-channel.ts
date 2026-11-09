/**
 * Which sales channels a partner made, and which of those are safe to clean up
 * (#2527).
 *
 * 🔑 A channel with no store is NOT an orphan. On prod (2026-11-09) both
 * channels without a store were ours: "Partner Work Orders" (found BY NAME in
 * `dual-write-unified-order.ts`) and a POS channel kept for later. Cleanup is
 * therefore opt-in by marker: only a channel stamped as partner-created is ever
 * eligible, and everything an admin created is left alone whatever it looks
 * like.
 *
 * The marker lives on the channel itself because the store is exactly what is
 * gone when cleanup matters — Zovvy's channel had `metadata: null`, so once its
 * store was deleted nothing said whose it had been.
 */

export const PARTNER_CHANNEL_CREATED_BY = "partner_store"

export type PartnerChannelMarker = {
  created_by: typeof PARTNER_CHANNEL_CREATED_BY
  partner_id: string
}

export function partnerChannelMetadata(partnerId: string): PartnerChannelMarker {
  return { created_by: PARTNER_CHANNEL_CREATED_BY, partner_id: partnerId }
}

export function isPartnerSalesChannel(
  channel: { metadata?: Record<string, unknown> | null } | null | undefined
): boolean {
  return channel?.metadata?.created_by === PARTNER_CHANNEL_CREATED_BY
}

export type PartnerChannelCleanupFacts = {
  channels: Array<{
    id: string
    name?: string | null
    metadata?: Record<string, unknown> | null
  }>
  /** Default channels of LIVE (not soft-deleted) stores. */
  live_store_channel_ids: string[]
  /** Orders still in flight, per channel id. */
  live_order_ids_by_channel: Record<string, string[]>
}

export type PartnerChannelCleanupPlan = {
  delete: Array<{ id: string; name: string | null; partner_id: string | null }>
  skipped: Array<{ id: string; name: string | null; reason: string }>
}

/**
 * PURE: which channels to soft-delete. A channel goes only when it is
 * partner-created, no live store uses it, and no order on it is in flight.
 * Admin-created channels are never listed at all — not even as skipped — so a
 * preview cannot be misread as "these were considered".
 */
export function planPartnerChannelCleanup(
  facts: PartnerChannelCleanupFacts
): PartnerChannelCleanupPlan {
  const liveStoreChannels = new Set(facts.live_store_channel_ids)
  const plan: PartnerChannelCleanupPlan = { delete: [], skipped: [] }

  for (const c of facts.channels) {
    if (!c?.id || !isPartnerSalesChannel(c)) continue
    const name = c.name ?? null
    if (liveStoreChannels.has(c.id)) continue

    const live = facts.live_order_ids_by_channel[c.id] ?? []
    if (live.length) {
      plan.skipped.push({
        id: c.id,
        name,
        reason: `${live.length} order(s) still in flight (${live
          .slice(0, 3)
          .join(", ")}${live.length > 3 ? ", …" : ""})`,
      })
      continue
    }

    const partnerId = c.metadata?.partner_id
    plan.delete.push({
      id: c.id,
      name,
      partner_id: typeof partnerId === "string" ? partnerId : null,
    })
  }

  return plan
}
