import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"

/**
 * Follow an Etsy order's lifecycle onto the Medusa order we created for it:
 *   order.canceled  → cancel the Medusa order
 *   order.shipped   → stamp fulfillment status = shipped
 *   order.delivered → stamp fulfillment status = delivered
 *
 * Etsy fulfillment is coarse (a single shipped/delivered flag), so shipped/
 * delivered are recorded as order metadata rather than fabricated Medusa
 * fulfillment objects. The order must already exist (created on order.paid);
 * if it doesn't yet we simply skip.
 */
export default async function etsyOrderLifecycleHandler({
  event,
  container,
}: SubscriberArgs<{ resource?: any; resource_url?: string }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

  // Resolve the receipt (carried on the event, else fetched).
  let receipt: any = event.data?.resource
  if (!receipt && event.data?.resource_url) {
    try {
      const account = await service.ensureFreshToken()
      receipt = await service
        .getClient()
        .fetchResource((account as any).access_token, event.data.resource_url)
    } catch {
      return
    }
  }
  const receiptId = receipt?.receipt_id != null ? String(receipt.receipt_id) : null
  if (!receiptId) return

  const [mapRow] = await service
    .listEtsyOrders({ receipt_id: receiptId } as any)
    .catch(() => [])
  const orderId = (mapRow as any)?.order_id
  if (!orderId) return // order not created yet — nothing to update

  const orderService: any = container.resolve(Modules.ORDER)

  try {
    if (event.name === "etsy.order.canceled") {
      await cancelOrderWorkflow(container).run({ input: { order_id: orderId } })
      await service.updateEtsyOrders({ id: (mapRow as any).id, status: "canceled" } as any)
      logger?.info?.(`[etsy-order] canceled Medusa order ${orderId} (receipt ${receiptId})`)
      return
    }

    const fulfillmentStatus =
      event.name === "etsy.order.delivered" ? "delivered" : "shipped"

    // Merge into existing metadata rather than clobber it.
    const existing = await orderService
      .retrieveOrder(orderId, { select: ["id", "metadata"] })
      .catch(() => null)
    const metadata = {
      ...((existing?.metadata as any) || {}),
      etsy_fulfillment_status: fulfillmentStatus,
    }
    await orderService.updateOrders([{ id: orderId, metadata }])
    await service.updateEtsyOrders({
      id: (mapRow as any).id,
      status: fulfillmentStatus,
    } as any)
    logger?.info?.(
      `[etsy-order] order ${orderId} fulfillment → ${fulfillmentStatus} (receipt ${receiptId})`
    )
  } catch (err: any) {
    logger?.warn?.(
      `[etsy-order] lifecycle ${event.name} failed for order ${orderId}: ${err?.message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["etsy.order.canceled", "etsy.order.shipped", "etsy.order.delivered"],
}
