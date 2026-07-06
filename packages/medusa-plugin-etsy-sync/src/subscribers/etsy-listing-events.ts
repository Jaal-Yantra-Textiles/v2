import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Surface notable Etsy listing lifecycle changes (detected by the reconcile
 * job) to the admin feed, so a seller sees when a listing went sold-out /
 * expired / was removed on Etsy — the things they'd otherwise only notice by
 * logging into Etsy. Extend here to auto-restock or re-list.
 */
const LABELS: Record<string, string> = {
  "etsy.listing.sold_out": "sold out",
  "etsy.listing.expired": "expired",
  "etsy.listing.deleted": "was removed",
  "etsy.listing.inactive": "was deactivated",
}

export default async function etsyListingEventsHandler({
  event,
  container,
}: SubscriberArgs<{ listing_id?: string; product_id?: string; from?: string; to?: string }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const label = LABELS[event.name] || event.data?.to || "changed"
  const listingId = event.data?.listing_id

  try {
    const notification: any = container.resolve(Modules.NOTIFICATION)
    await notification.createNotifications({
      to: "",
      channel: "feed",
      template: "admin-ui",
      data: {
        title: "Etsy listing update",
        description: `Etsy listing ${listingId ?? ""} ${label}.`,
      },
    })
  } catch (err: any) {
    logger?.warn?.(`[etsy-listing] notify failed for ${event.name}: ${err?.message}`)
  }
}

export const config: SubscriberConfig = {
  event: [
    "etsy.listing.sold_out",
    "etsy.listing.expired",
    "etsy.listing.deleted",
    "etsy.listing.inactive",
  ],
}
