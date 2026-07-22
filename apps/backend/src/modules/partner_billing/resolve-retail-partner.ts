import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import partnerOrderLink from "../../links/partner-order"

/**
 * Resolve the owning partner for a RETAIL order from its sales channel.
 *
 * Retail (storefront) orders have no partner↔order work-order link. Ownership is
 * defined exactly as `validatePartnerOrderOwnership` does it:
 *   order.sales_channel_id === partner.store.default_sales_channel_id
 * i.e. the order sits in the partner store's default sales channel. We read
 * every partner's `stores.default_sales_channel_id` (partners are few) and match.
 *
 * (The earlier `sales_channel → store → partner_partner_store_store` traversal
 * was wrong: `sales_channel.store` isn't exposed and the link alias doesn't
 * resolve — it always returned null.)
 *
 * Returns null for the platform's own (non-partner) channels and on any lookup
 * failure — accrual must never throw.
 */
export async function resolveRetailPartnerId(
  container: any,
  salesChannelId: string | null | undefined
): Promise<string | null> {
  if (!salesChannelId) return null
  const map = await buildRetailPartnerBySalesChannel(container)
  return map.get(salesChannelId) || null
}

/**
 * Resolve the owning partner for ANY order — the same two-rule ownership the
 * partner API enforces (`validatePartnerOrderOwnership`) and the partner-order
 * email uses:
 *   1. Work order: the explicit partner↔order link (source of truth) — a
 *      partner can serve another partner's store, so work-orders need the link.
 *   2. Retail order: `order.sales_channel_id === partner.store.default_sales_channel_id`.
 *
 * Shared seam for provenance-run partner attribution (#1121) and #1111 S4.
 * Never throws — returns null when no partner owns the order.
 */
export async function resolveOwningPartnerId(
  container: any,
  input: { orderId: string; salesChannelId?: string | null }
): Promise<string | null> {
  // 1) Work order: explicit partner↔order link.
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: links } = await query.graph({
      entity: partnerOrderLink.entryPoint,
      fields: ["partner_id"],
      filters: { order_id: input.orderId },
      pagination: { skip: 0, take: 1 },
    })
    const linked = (links?.[0] as any)?.partner_id
    if (linked) return linked
  } catch {
    // link table absent / empty — fall through to the retail rule
  }

  // 2) Retail order: sales-channel ownership rule.
  return resolveRetailPartnerId(container, input.salesChannelId)
}

/**
 * Build a `default_sales_channel_id → partner_id` map for all partners in one
 * query — shared by the single-order resolver and the backfill job (which
 * resolves many orders and shouldn't re-scan partners per order). Never throws.
 */
export async function buildRetailPartnerBySalesChannel(
  container: any
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  try {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.default_sales_channel_id"],
      pagination: { skip: 0, take: 1000 },
    })
    for (const p of partners || []) {
      for (const st of p?.stores || []) {
        if (st?.default_sales_channel_id && p?.id) {
          map.set(st.default_sales_channel_id, p.id)
        }
      }
    }
  } catch {
    // best-effort — empty map means no retail partner resolves (accrual skipped)
  }
  return map
}
