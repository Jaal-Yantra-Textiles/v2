import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ETSY_SYNC_MODULE } from "../modules/etsy-sync"
import EtsySyncService from "../modules/etsy-sync/service"
import { ingestEtsyOrderWorkflow } from "../workflows/ingest-etsy-order"

/**
 * Create a Medusa order from a paid Etsy order.
 *
 * Fired by the `etsy.order.paid` event the webhook receiver emits (kept off the
 * webhook request path so the 200 stays fast). The Etsy receipt is carried on
 * the event; if it wasn't fetched at webhook time we refetch from resource_url.
 *
 * Kill switch: set ETSY_INGEST_ORDERS=false to disable order creation while
 * still recording webhook deliveries.
 */
export default async function etsyOrderIngestHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  resource?: any
  resource_url?: string
  webhook_id?: string
}>) {
  if (process.env.ETSY_INGEST_ORDERS === "false") return

  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const service: EtsySyncService = container.resolve(ETSY_SYNC_MODULE)

  let receipt: any = data?.resource
  if (!receipt && data?.resource_url) {
    try {
      const account = await service.ensureFreshToken()
      receipt = await service
        .getClient()
        .fetchResource((account as any).access_token, data.resource_url)
    } catch (err: any) {
      logger?.warn?.(`[etsy-order] could not fetch receipt: ${err?.message}`)
      return
    }
  }
  if (!receipt) return

  try {
    await ingestEtsyOrderWorkflow(container).run({
      input: {
        receipt,
        etsy_order_id: receipt?.order_id != null ? String(receipt.order_id) : null,
      },
    })
  } catch (err: any) {
    logger?.warn?.(
      `[etsy-order] ingest failed for receipt ${receipt?.receipt_id}: ${err?.message}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "etsy.order.paid",
}
