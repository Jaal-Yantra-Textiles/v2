import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
} from "@medusajs/framework/utils"
import type { MedusaContainer } from "@medusajs/framework/types"
import {
  createOrderShipmentWorkflow,
  markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import { resolveShippingProvider } from "../../modules/shipping-providers/resolver"

/**
 * #437 — attach an EXISTING Shiprocket AWB to a (converted) order, for parcels
 * already shipped/delivered directly in the Shiprocket dashboard or before this
 * system existed. Unlike `createShiprocketShipmentForFulfillment` (which creates
 * a brand-new Shiprocket order + AWB), this is READ-ONLY against Shiprocket: it
 * `track`s the AWB to validate + hydrate it, stamps the carrier refs onto
 * `fulfillment.data` (what the label/tracking routes read), and auto-syncs the
 * order's fulfillment status to match the AWB's real Shiprocket state.
 */

export type AttachAwbResult = {
  awb: string
  current_status?: string
  /** What we synced the fulfillment to, derived from the live Shiprocket status. */
  synced_state: "delivered" | "shipped" | "pending"
  fulfillment_id: string
}

/**
 * Shiprocket `shipment_status_id` (and a status-text fallback) → coarse
 * fulfillment state for auto-sync. Codes mirror the carrier client's
 * `scanTypeForStatus`: 7 = delivered, 6/42 = in-transit/out-for-delivery.
 */
export function deriveFulfillmentState(
  code?: number,
  statusText?: string
): "delivered" | "shipped" | "pending" {
  if (code === 7) return "delivered"
  if (code === 6 || code === 42) return "shipped"
  const t = (statusText || "").toLowerCase()
  // "out for delivery" contains "deliver" but is NOT delivered — match the
  // shipped signals first, then the exact "delivered" signal.
  if (
    t.includes("transit") ||
    t.includes("shipped") ||
    t.includes("out for delivery") ||
    t.includes("picked")
  ) {
    return "shipped"
  }
  if (t.includes("delivered")) return "delivered"
  return "pending"
}

/**
 * PURE: the full `labels` array to write so this AWB is discoverable by the
 * Shiprocket webhook.
 *
 * #1195 — the webhook has exactly ONE way to find a core fulfillment from an
 * AWB: `query.graph({ entity: "fulfillment", filters: { labels: {
 * tracking_number } } })` in `sync-order-shipment-tracking.ts` (`data.waybill`
 * is JSONB and cannot be filtered). Attaching an AWB without a label row left
 * the fulfillment permanently invisible to every later status push.
 *
 * ALWAYS returns the complete desired set, never a delta: `updateFulfillment`
 * treats `labels` as a full replace, so existing rows must be carried through
 * by id or the ORM deletes them. (This is also why
 * `createOrderShipmentWorkflow`'s default `labels: []` is dangerous — it wipes
 * the collection. The caller passes this array to it instead.)
 *
 * Idempotent: re-attaching the same AWB yields the same set, adding nothing.
 * Exported for unit testing.
 */
export function buildAttachAwbLabels(
  existingLabels: any[] | undefined,
  label: { tracking_number: string; tracking_url: string; label_url: string }
): Array<{ id: string } | typeof label> {
  const existing = existingLabels ?? []
  const carried = existing
    .filter((l: any) => !!l?.id)
    .map((l: any) => ({ id: l.id as string }))
  if (existing.some((l: any) => l?.tracking_number === label.tracking_number)) {
    return carried
  }
  return [...carried, label]
}

export async function attachExistingShiprocketAwb(
  container: MedusaContainer,
  input: { orderId: string; fulfillmentId: string; awb: string }
): Promise<AttachAwbResult> {
  const awb = (input.awb || "").trim()
  if (!awb) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "An AWB is required")
  }

  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModule: any = container.resolve(Modules.FULFILLMENT)
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "items.id",
      // `quantity` is computed from raw_quantity — read it off `detail`.
      "items.detail.quantity",
      "fulfillments.id",
      "fulfillments.data",
      // Needed to merge rather than clobber — `updateFulfillment` replaces the
      // whole `labels` collection.
      "fulfillments.labels.id",
      "fulfillments.labels.tracking_number",
    ],
    filters: { id: input.orderId },
  })
  const order = orders?.[0]
  if (!order) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Order ${input.orderId} not found`
    )
  }
  const fulfillment = (order.fulfillments || []).find(
    (f: any) => f.id === input.fulfillmentId
  )
  if (!fulfillment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Fulfillment ${input.fulfillmentId} not found on order ${input.orderId}`
    )
  }

  const provider = await resolveShippingProvider(container, "shiprocket")
  if (!provider.track) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Shiprocket provider does not support tracking lookups"
    )
  }

  // Read-only lookup: validates the AWB belongs to this Shiprocket account and
  // hydrates its real status/courier. A bad/foreign AWB surfaces cleanly.
  let tracking: any
  try {
    tracking = await provider.track({ awb })
  } catch (e: any) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Could not look up AWB ${awb} on Shiprocket: ${e?.message ?? e}`
    )
  }
  const hasShipment =
    tracking &&
    (tracking.awb ||
      tracking.current_status ||
      (tracking.events || []).length > 0)
  if (!hasShipment) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Shiprocket returned no shipment for AWB ${awb}. Check the AWB belongs to this Shiprocket account.`
    )
  }

  const refs = tracking.raw?.shipment_track?.[0] || {}
  const shipmentId = refs.shipment_id ?? refs.id
  const trackingUrl = `https://shiprocket.co/tracking/${awb}`

  // #1195: the label row the Shiprocket webhook matches on. Written in exactly
  // ONE place below — `createOrderShipmentWorkflow` sends `labels: []` through
  // to `updateFulfillment`, which replaces the collection, so writing it here
  // and shipping afterwards would silently delete it again.
  const labels = buildAttachAwbLabels(fulfillment.labels, {
    tracking_number: awb,
    tracking_url: trackingUrl,
    label_url: "",
  })

  await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
    data: {
      ...(fulfillment.data || {}),
      carrier: "shiprocket",
      waybill: awb,
      tracking_number: awb,
      tracking_url: trackingUrl,
      current_status: tracking.current_status,
      shipment_id: shipmentId,
      sr_order_id: refs.sr_order_id,
      attached_existing: true,
      provider_refs: {
        shipment_id: shipmentId,
        sr_order_id: refs.sr_order_id,
        courier_name: refs.courier_name,
      },
    },
  })

  const state = deriveFulfillmentState(
    tracking.current_status_code != null
      ? Number(tracking.current_status_code)
      : undefined,
    tracking.current_status
  )

  // Auto-sync the order's fulfillment status to reality. createOrderShipment
  // marks the fulfillment shipped; markDelivered then closes it out. Both are
  // best-effort — a benign "already in that state" must not fail the attach.
  let labelsWritten = false
  if (state === "shipped" || state === "delivered") {
    const items = (order.items || []).map((i: any) => ({
      id: i.id,
      quantity: Number(i.detail?.quantity ?? i.quantity) || 1,
    }))
    try {
      await createOrderShipmentWorkflow(container).run({
        input: {
          order_id: input.orderId,
          fulfillment_id: input.fulfillmentId,
          items,
          // NOT `[]` — that is a full replace and would drop the AWB label.
          labels: labels as any,
          no_notification: true,
        },
      })
      labelsWritten = true
    } catch (e: any) {
      logger.warn(
        `[attach-awb] mark-shipped skipped for fulfillment ${input.fulfillmentId}: ${e?.message}`
      )
    }
  }

  // Pending parcels never reach the shipment workflow, and a skipped/failed
  // one must not cost us the label either — the webhook is how such a parcel
  // eventually moves.
  if (!labelsWritten) {
    try {
      await fulfillmentModule.updateFulfillment(input.fulfillmentId, {
        labels: labels as any,
      })
    } catch (e: any) {
      logger.warn(
        `[attach-awb] label write failed for fulfillment ${input.fulfillmentId}: ${e?.message}`
      )
    }
  }
  if (state === "delivered") {
    try {
      await markOrderFulfillmentAsDeliveredWorkflow(container).run({
        input: {
          orderId: input.orderId,
          fulfillmentId: input.fulfillmentId,
          no_notification: true,
        } as any,
      })
    } catch (e: any) {
      logger.warn(
        `[attach-awb] mark-delivered skipped for fulfillment ${input.fulfillmentId}: ${e?.message}`
      )
    }
  }

  return {
    awb,
    current_status: tracking.current_status,
    synced_state: state,
    fulfillment_id: input.fulfillmentId,
  }
}
