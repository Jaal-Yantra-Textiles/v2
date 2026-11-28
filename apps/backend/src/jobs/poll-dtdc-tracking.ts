import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { FULLFILLED_ORDERS_MODULE } from "../modules/fullfilled_orders"
import { resolveShippingProvider } from "../modules/shipping-providers/resolver"
import type { ShippingProviderClient } from "../modules/shipping-providers/provider-interface"
import { syncInventoryShipmentTrackingWorkflow } from "../workflows/inventory_orders/sync-inventory-shipment-tracking"

/**
 * Hourly DTDC tracking for inventory-order shipments.
 *
 * DTDC pushes no webhook to us, so without this a partner's DTDC shipment sat
 * at `created` forever. Same shape as poll-delhivery-tracking: list the open
 * DTDC shipments, ask DTDC's tracking API for each AWB, and feed the result to
 * the shared sync workflow (which moves the row forward only, emits the
 * status-changed event, and closes the order when everything is delivered).
 */
const OPEN_STATUSES = ["created", "pickup_scheduled", "picked_up", "in_transit", "out_for_delivery"]
const MAX_PER_RUN = 100

export default async function pollDtdcTracking(container: MedusaContainer) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)

  let provider: ShippingProviderClient
  try {
    provider = await resolveShippingProvider(container, "dtdc")
  } catch (e: any) {
    logger.debug?.(`[dtdc-poll] provider unavailable: ${e?.message}`)
    return
  }
  if (typeof provider?.track !== "function") {
    logger.warn?.("[dtdc-poll] dtdc provider has no track method, skipping")
    return
  }

  let awbs: string[] = []
  try {
    const fulfilledOrders: any = container.resolve(FULLFILLED_ORDERS_MODULE)
    const shipments = await fulfilledOrders.listInventoryShipments({
      carrier: "dtdc",
      status: OPEN_STATUSES,
    })
    awbs = Array.from(
      new Set((shipments || []).map((s: any) => String(s?.awb || "").trim()).filter(Boolean))
    ).slice(0, MAX_PER_RUN) as string[]
  } catch (e: any) {
    logger.warn(`[dtdc-poll] could not list inventory shipments: ${e?.message || e}`)
    return
  }
  if (!awbs.length) return

  let checked = 0
  let advanced = 0
  for (const awb of awbs) {
    try {
      const tracking = await provider.track({ awb })
      checked++
      const { result } = await syncInventoryShipmentTrackingWorkflow(container).run({
        input: { tracking },
      })
      if (result?.shipment_status_changed) advanced++
    } catch (e: any) {
      logger.warn(`[dtdc-poll] AWB ${awb} failed: ${e?.message || e}`)
    }
  }
  logger.info(`[dtdc-poll] checked=${checked}/${awbs.length} advanced=${advanced}`)
}

export const config = {
  name: "poll-dtdc-tracking",
  schedule: "15 * * * *",
}
