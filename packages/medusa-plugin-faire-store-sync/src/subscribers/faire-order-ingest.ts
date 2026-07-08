import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { FAIRE_SYNC_MODULE } from "../modules/faire-sync"
import FaireSyncService from "../modules/faire-sync/service"
import { ingestFaireOrderWorkflow } from "../workflows/ingest-faire-order"

/**
 * Create a Medusa order from a placed Faire order.
 *
 * Fired by the `faire.order_placed` (or `faire.order_created`) event the webhook
 * receiver emits, kept off the webhook request path so the 200 stays fast. The
 * Faire order is carried on the event; if it wasn't fetched at webhook time we
 * refetch from resource_url.
 *
 * Kill switch: set FAIRE_INGEST_ORDERS=false to disable order creation while
 * still recording webhook deliveries.
 */
export default async function faireOrderIngestHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  resource?: any
  resource_url?: string
  webhook_id?: string
}>) {
  if (process.env.FAIRE_INGEST_ORDERS === "false") return

  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: FaireSyncService = container.resolve(FAIRE_SYNC_MODULE)

  let order: any = data?.resource
  if (!order && data?.resource_url) {
    try {
      const account = await service.ensureFreshToken()
      order = await service
        .getClient()
        .fetchResource((account as any).access_token, data.resource_url)
    } catch (err: any) {
      logger?.warn?.(`[faire-order] could not fetch order: ${err?.message}`)
      return
    }
  }
  if (!order) return

  try {
    await ingestFaireOrderWorkflow(container).run({
      input: {
        order,
        order_token: order?.order_token != null ? String(order.order_token) : null,
      },
    })
  } catch (err: any) {
    logger?.warn?.(
      `[faire-order] ingest failed for order ${order?.order_token}: ${err?.message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: ["faire.order_placed", "faire.order_created"],
}
