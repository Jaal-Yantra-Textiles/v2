import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"

/**
 * Follow a Faire order's lifecycle onto the Medusa order we created for it:
 *   order.canceled → cancel the Medusa order
 *   order.shipped  → stamp fulfillment status = shipped
 *   order.delivered→ stamp fulfillment status = delivered
 *
 * The order must already exist (created on order.placed); if it doesn't yet we
 * simply skip.
 */
export default async function faireOrderLifecycleHandler({
  event,
  container,
}: SubscriberArgs<{ resource?: any; resource_url?: string }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

  let order: any = event.data?.resource
  if (!order && event.data?.resource_url) {
    try {
      const account = await service.ensureFreshToken()
      order = await service
        .getClient()
        .fetchResource((account as any).access_token, event.data.resource_url)
    } catch {
      return
    }
  }
  const orderToken =
    order?.order_token != null ? String(order.order_token) : null
  if (!orderToken) return

  const [mapRow] = await service
    .listFaireOrders({ order_token: orderToken } as any)
    .catch(() => [])
  const orderId = (mapRow as any)?.order_id
  if (!orderId) return

  const orderService: any = container.resolve(Modules.ORDER)

  try {
    if (event.name === "faire.order_canceled") {
      await cancelOrderWorkflow(container).run({ input: { order_id: orderId } })
      await service.updateFaireOrders({ id: (mapRow as any).id, status: "canceled" } as any)
      logger?.info?.(`[faire-order] canceled Medusa order ${orderId} (Faire ${orderToken})`)
      return
    }

    const fulfillmentStatus =
      event.name === "faire.order_delivered" ? "delivered" : "shipped"

    const existing = await orderService
      .retrieveOrder(orderId, { select: ["id", "metadata"] })
      .catch(() => null)
    const metadata = {
      ...((existing?.metadata as any) || {}),
      faire_fulfillment_status: fulfillmentStatus,
    }
    await orderService.updateOrders([{ id: orderId, metadata }])
    await service.updateFaireOrders({
      id: (mapRow as any).id,
      status: fulfillmentStatus,
    } as any)
    logger?.info?.(
      `[faire-order] order ${orderId} fulfillment → ${fulfillmentStatus} (Faire ${orderToken})`
    )
  } catch (err: any) {
    logger?.warn?.(
      `[faire-order] lifecycle ${event.name} failed for order ${orderId}: ${err?.message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["faire.order_canceled", "faire.order_shipped", "faire.order_delivered"],
}
