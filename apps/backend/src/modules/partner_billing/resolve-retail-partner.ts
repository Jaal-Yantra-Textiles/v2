import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Resolve the owning partner for a RETAIL order by traversing
 *   order.sales_channel_id → sales_channel ↔ store → partner_store link → partner
 *
 * This is the retail counterpart to the work-order `partner↔order` D3 link:
 * storefront (retail) orders have no work-order link, so their partner is found
 * through the sales channel's store. Returns null for the platform's own
 * (non-partner) stores and on any lookup failure — accrual must never throw.
 */
export async function resolveRetailPartnerId(
  container: any,
  salesChannelId: string | null | undefined
): Promise<string | null> {
  if (!salesChannelId) return null
  const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
  try {
    const { data: scLinks } = await query.graph({
      entity: "sales_channel",
      fields: ["id", "store.id"],
      filters: { id: salesChannelId },
    })
    const storeId = scLinks?.[0]?.store?.id || null
    if (!storeId) return null

    const { data: partnerStoreLinks } = await query.graph({
      entity: "partner_partner_store_store",
      fields: ["partner_id"],
      filters: { store_id: storeId },
      pagination: { skip: 0, take: 1 },
    })
    return partnerStoreLinks?.[0]?.partner_id || null
  } catch {
    return null
  }
}
