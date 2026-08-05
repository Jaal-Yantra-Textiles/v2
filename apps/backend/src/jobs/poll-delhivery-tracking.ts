import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { resolveShippingProvider } from "../modules/shipping-providers/resolver"
import { normalizeDelhiveryWebhook } from "../modules/shipping-providers/delhivery/client"
import { syncOrderShipmentTrackingWorkflow } from "../workflows/orders/sync-order-shipment-tracking"
import { syncInventoryShipmentTrackingWorkflow } from "../workflows/inventory_orders/sync-inventory-shipment-tracking"

/**
 * Keep Delhivery shipments' status current by POLLING.
 *
 * Shiprocket pushes status changes to `/webhooks/shipping/track` and everything
 * stays fresh for free. Delhivery's equivalent status push has to be switched on
 * by their account team, so until that happens a Delhivery parcel would sit at
 * "Awaiting shipping" in the UI forever no matter what the carrier knows.
 *
 * This closes that gap with the API we already have (`trackShipment`) and feeds
 * the SAME sync workflows the webhook uses, so both paths converge on identical
 * state. When the push is eventually enabled the webhook just gets there first
 * and this job finds nothing to change — the sync is forward-only and
 * idempotent, so the two never fight.
 *
 * Only open shipments are polled: anything already delivered or canceled is
 * terminal, and re-asking the carrier about it is pure quota burn.
 */

/** Cap per run so a large backlog can't stall the scheduler or spam the API. */
const MAX_PER_RUN = 100

export default async function pollDelhiveryTracking(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  let provider: any
  try {
    provider = await resolveShippingProvider(container, "delhivery")
  } catch (e: any) {
    // Delhivery not configured on this deployment — not an error, just nothing
    // to do. Debug, not warn, or every install without it logs noise hourly.
    logger.debug?.(`[delhivery-poll] provider unavailable: ${e?.message}`)
    return
  }
  if (!provider?.trackShipment) {
    logger.debug?.("[delhivery-poll] provider has no trackShipment — skipping")
    return
  }

  // `data` is JSONB and can't be filtered on, so pull open fulfillments and
  // narrow in memory (the same reason the webhook matches on
  // fulfillment_label.tracking_number rather than data.waybill).
  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    fields: ["id", "data", "shipped_at", "delivered_at", "canceled_at"],
    filters: { delivered_at: null, canceled_at: null },
  })

  const open = (fulfillments || [])
    .filter(
      (f: any) => f?.data?.carrier === "delhivery" && !!f?.data?.waybill
    )
    .slice(0, MAX_PER_RUN)

  if (!open.length) {
    return
  }

  let checked = 0
  let advanced = 0

  for (const fulfillment of open) {
    const awb = String(fulfillment.data.waybill)
    try {
      const raw = await provider.trackShipment(awb)
      // The pull response and the push payload share Delhivery's `Shipment`
      // envelope, so one normalizer serves both. `ShipmentData` is the pull's
      // outer array.
      const shipment = raw?.ShipmentData?.[0] ?? raw
      const tracking = normalizeDelhiveryWebhook(shipment)
      if (!tracking.awb) {
        tracking.awb = awb
      }
      checked++

      // Try inventory shipments first, then core orders — same order as the
      // webhook, so a given AWB always resolves the same way.
      const { result: inv } = await syncInventoryShipmentTrackingWorkflow(
        container
      ).run({ input: { tracking: { ...tracking, raw: shipment } } })
      if (inv.matched) {
        if (inv.shipment_status_changed) advanced++
        continue
      }

      const { result: order } = await syncOrderShipmentTrackingWorkflow(
        container
      ).run({ input: { tracking: { ...tracking, raw: shipment } } })
      if (order.matched && order.status_changed) {
        advanced++
      }
    } catch (e: any) {
      // One dead AWB must not stop the batch.
      logger.warn(`[delhivery-poll] AWB ${awb} failed: ${e?.message || e}`)
    }
  }

  logger.info(
    `[delhivery-poll] checked=${checked}/${open.length} advanced=${advanced}`
  )
}

export const config = {
  name: "poll-delhivery-tracking",
  // Hourly. Delivery scans land a handful of times a day, so anything tighter
  // spends carrier quota to learn nothing.
  schedule: "0 * * * *",
}
