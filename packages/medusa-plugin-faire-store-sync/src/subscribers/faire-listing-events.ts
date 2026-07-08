import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Surface notable Faire product/listing changes to the admin feed. Faire emits
 * outbound webhooks for product updates; the webhook receiver re-emits internal
 * `faire.product.*` / `faire.listing.*` events that this subscriber turns into
 * admin feed notifications. Extend here to auto-restock or re-list.
 */
const LABELS: Record<string, string> = {
  "faire.product_updated": "was updated on Faire",
  "faire.product_sold_out": "sold out on Faire",
  "faire.product_deactivated": "was deactivated on Faire",
  "faire.listing.deleted": "was removed on Faire",
}

export default async function faireListingEventsHandler({
  event,
  container,
}: SubscriberArgs<{ product_token?: string; resource?: any }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const label = LABELS[event.name] || "changed on Faire"
  const token = event.data?.product_token

  try {
    const notification: any = container.resolve(Modules.NOTIFICATION)
    await notification.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title: "Faire product update",
        description: `Faire product ${token ?? ""} ${label}.`,
      },
    })
  } catch (err: any) {
    logger?.warn?.(`[faire-listing] notify failed for ${event.name}: ${err?.message}`)
  }
}

export const config: SubscriberConfig = {
  event: [
    "faire.product_updated",
    "faire.product_sold_out",
    "faire.product_deactivated",
    "faire.listing.deleted",
  ],
}
