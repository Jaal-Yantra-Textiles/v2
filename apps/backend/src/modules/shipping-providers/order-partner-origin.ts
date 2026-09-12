import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import partnerOrderLink from "../../links/partner-order"
import { pickPartnerShipFromLocation } from "../../api/partners/lib/ship-from-location"
import { SHIPROCKET_PICKUP_METADATA_KEY } from "./pickup-locations"
import { FULLFILLED_ORDERS_MODULE } from "../fullfilled_orders"

/**
 * Resolve the partner that OWNS a core/retail order — and their ship-from stock
 * location — FROM THE ORDER ALONE (#1111 S4). This is the retail/admin
 * counterpart to `resolvePartnerShipFromLocation` (api/partners/helpers), which
 * needs the authenticated partner: retail orders arrive through the storefront
 * with no partner in the auth context, so origin must be derived from the order.
 *
 * Ownership mirrors `validatePartnerOrderOwnership` exactly — the two scoping
 * rules the partner order list uses:
 *   - work (design / inventory): the D3 `partner ↔ order` link.
 *   - retail: `order.sales_channel_id` === a partner store's
 *     `default_sales_channel_id`.
 *
 * The ship-from location is always taken from the PARTNER'S store default sales
 * channel (not the order's channel): retail's order channel IS that channel, but
 * a work order lives in the shared work-orders channel, so using the order
 * channel there would find no partner location. Same location the partner-auth
 * label flow ships from.
 *
 * Everything here is BEST-EFFORT — every path degrades to nulls (never throws)
 * so label generation falls back to the existing admin behaviour rather than
 * blocking on a partner that can't be resolved.
 */

export type OrderPartnerId = {
  partnerId: string | null
  /** How the partner was resolved — for logging / callers that branch on it. */
  source: "work" | "retail" | null
}

export type OrderShipFromOrigin = OrderPartnerId & {
  /** The owning partner's ship-from stock location for this order, if any. */
  locationId: string | null
  /** Acting/notification email for a freshly-registered pickup (#427). */
  actingEmail: string | null
  /**
   * Where `locationId` came from (#891 S4). `goods_transfer` means the goods
   * have physically MOVED since they were produced and the label follows them;
   * `partner_default` is the pre-S4 behaviour.
   */
  locationSource: "goods_transfer" | "partner_default" | null
}

/** Why a set of production runs did or did not agree on one goods location. */
export type GoodsLocationVerdict = {
  locationId: string | null
  reason: "agreed" | "split" | "none"
}

/**
 * PURE: given where each of an order's runs currently holds its goods, what is
 * the one location the order can ship from? (#891 S4)
 *
 * An order can span several production runs, and after S3 each may have been
 * received somewhere different. A fulfillment has exactly ONE origin, so:
 *
 *  - all runs agree → that location
 *  - they disagree (`split`) → NOTHING. The goods are genuinely in two places
 *    and no single origin is correct; picking one would put a confident wrong
 *    address on a label. Falling back to the partner default at least keeps
 *    the long-standing, understood behaviour instead of inventing a new wrong
 *    answer, and the split is logged.
 *  - none has moved → nothing to say; the partner default stands
 */
export function pickCurrentGoodsLocation(
  runLocations: Array<string | null | undefined>
): GoodsLocationVerdict {
  const moved = (runLocations || [])
    .map((l) => (l ? String(l) : ""))
    .filter(Boolean)
  if (!moved.length) return { locationId: null, reason: "none" }

  const distinct = Array.from(new Set(moved))
  if (distinct.length > 1) return { locationId: null, reason: "split" }
  return { locationId: distinct[0], reason: "agreed" }
}

/**
 * Where an order's produced goods physically are NOW (#891 S4).
 *
 * Produced output is banked at the producing partner's location, and a
 * delivered `goods_transfer` is the record that it moved somewhere else. Until
 * S4 nothing on the customer leg read that, so a jacket received at the
 * finishing warehouse still shipped from the weaver — which re-creates the very
 * negative S3 exists to remove, one step further along.
 *
 * Only a DELIVERED transfer counts. A booked or in-transit hop means the goods
 * are between two places, and the origin they left is still the honest answer.
 *
 * Best-effort: any miss returns null so the partner default stands.
 */
export async function resolveOrderGoodsLocation(
  container: MedusaContainer,
  orderId: string
): Promise<GoodsLocationVerdict> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { data: runs } = await query.graph({
      entity: "production_runs",
      fields: ["id"],
      filters: { order_id: orderId },
    })
    const runIds = (runs ?? []).map((r: any) => r?.id).filter(Boolean)
    if (!runIds.length) return { locationId: null, reason: "none" }

    const transfers: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    const landed = await Promise.all(
      runIds.map(async (runId: string) => {
        try {
          const prior = await transfers.listGoodsTransfers(
            { production_run_id: runId, status: "delivered" },
            { order: { received_at: "DESC" }, take: 1 }
          )
          return prior?.[0]?.to_location_id ?? null
        } catch {
          return null
        }
      })
    )
    return pickCurrentGoodsLocation(landed)
  } catch {
    return { locationId: null, reason: "none" }
  }
}

/** Read a single order's `sales_channel_id` (null on any error). */
async function orderSalesChannelId(
  query: any,
  orderId: string
): Promise<string | null> {
  const { data: orders } = await query.graph({
    entity: "orders",
    fields: ["id", "sales_channel_id"],
    filters: { id: orderId },
  })
  return (orders?.[0]?.sales_channel_id as string) ?? null
}

/**
 * Resolve the owning partner id for an order (work link first, then retail
 * sales-channel scoping). Best-effort → `{ partnerId: null, source: null }`.
 */
export async function resolveOrderPartnerId(
  container: MedusaContainer,
  orderId: string
): Promise<OrderPartnerId> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    // 1. Work ownership — the D3 partner↔order link (same source of truth as
    //    validatePartnerOrderOwnership / resolveSellerTaxIdForOrder).
    const { data: links } = await query.graph({
      entity: partnerOrderLink.entryPoint,
      fields: ["partner_id"],
      filters: { order_id: orderId },
    })
    const workPartnerId = (links?.[0]?.partner_id as string) ?? null
    if (workPartnerId) return { partnerId: workPartnerId, source: "work" }

    // 2. Retail ownership — the order's channel is a partner store's default
    //    channel. `default_sales_channel_id` is a plain column (sales_channel ↔
    //    store is not a Medusa link), and filters don't auto-join the
    //    partner_stores dot-path, so match the owner in JS — mirrors
    //    resolvePartnerStorefrontForSalesChannel (google_merchant).
    const salesChannelId = await orderSalesChannelId(query, orderId)
    if (!salesChannelId) return { partnerId: null, source: null }

    const { data: stores } = await query.graph({
      entity: "stores",
      fields: ["id", "default_sales_channel_id"],
      filters: { default_sales_channel_id: [salesChannelId] },
    })
    const storeIds = new Set(
      (stores ?? []).map((s: any) => s?.id).filter(Boolean)
    )
    if (!storeIds.size) return { partnerId: null, source: null }

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["id", "stores.id"],
    })
    const owner = (partners ?? []).find((p: any) =>
      (p?.stores ?? []).some((st: any) => storeIds.has(st?.id))
    )
    return owner?.id
      ? { partnerId: owner.id, source: "retail" }
      : { partnerId: null, source: null }
  } catch {
    return { partnerId: null, source: null }
  }
}

/** Pick the ship-from location among a sales channel's stock locations. */
async function locationForSalesChannel(
  query: any,
  salesChannelId: string | null
): Promise<string | null> {
  if (!salesChannelId) return null
  const { data: channels } = await query.graph({
    entity: "sales_channels",
    fields: [
      "stock_locations.id",
      "stock_locations.metadata",
      "stock_locations.address.phone",
      "stock_locations.address.postal_code",
    ],
    filters: { id: salesChannelId },
  })
  const candidates = ((channels?.[0]?.stock_locations || []) as any[]).map(
    (loc) => ({
      id: loc?.id,
      pickup_nickname:
        (loc?.metadata as any)?.[SHIPROCKET_PICKUP_METADATA_KEY] ?? null,
      phone: loc?.address?.phone ?? null,
      postal_code: loc?.address?.postal_code ?? null,
    })
  )
  return pickPartnerShipFromLocation(candidates)?.id ?? null
}

/**
 * Resolve the owning partner AND their ship-from stock location for an order.
 * The location comes from the partner's own store default sales channel (works
 * for both retail and work orders). Best-effort → nulls on any miss.
 */
export async function resolveOrderShipFromLocation(
  container: MedusaContainer,
  orderId: string
): Promise<OrderShipFromOrigin> {
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  try {
    const { partnerId, source } = await resolveOrderPartnerId(container, orderId)
    if (!partnerId) {
      return {
        partnerId: null,
        source: null,
        locationId: null,
        actingEmail: null,
        locationSource: null,
      }
    }

    const { data: partners } = await query.graph({
      entity: "partners",
      fields: [
        "id",
        "admins.email",
        "stores.default_sales_channel_id",
      ],
      filters: { id: partnerId },
    })
    const partner = partners?.[0]
    const partnerChannelId =
      (partner?.stores?.[0]?.default_sales_channel_id as string) ?? null
    const partnerLocationId = await locationForSalesChannel(query, partnerChannelId)

    // #891 S4 — the goods' CURRENT location wins over the partner default.
    // Output is banked where it was produced, and a delivered goods transfer is
    // the record that it moved. Shipping from the producing partner after the
    // goods were received elsewhere is what puts a real garment's origin on the
    // wrong label, and drives the origin location negative.
    const goods = await resolveOrderGoodsLocation(container, orderId)
    if (goods.reason === "split") {
      // Two runs on one order landed in different places, so no single origin
      // is correct. Say so loudly and keep the old, understood behaviour rather
      // than inventing a confident wrong address.
      try {
        const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
        logger.warn(
          `[ship-from] order ${orderId}: its production runs' goods are in DIFFERENT locations — no single origin is correct, falling back to the partner default`
        )
      } catch {
        /* logging must never break label generation */
      }
    }

    const locationId = goods.locationId ?? partnerLocationId
    return {
      partnerId,
      source,
      locationId,
      actingEmail: (partner?.admins?.[0]?.email as string) ?? null,
      locationSource: !locationId
        ? null
        : goods.locationId
          ? "goods_transfer"
          : "partner_default",
    }
  } catch {
    return {
      partnerId: null,
      source: null,
      locationId: null,
      actingEmail: null,
      locationSource: null,
    }
  }
}
