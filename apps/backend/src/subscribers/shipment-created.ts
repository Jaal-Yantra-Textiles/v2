import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendShipmentStatusEmail } from "../workflows/email/send-notification-email"

/**
 * The shipped mail is built from the fulfillment's labels, and its whole point
 * is the tracking number — the template says "Track the package below". With no
 * labels it renders an empty tracking block: a "your items are on the way"
 * notice the customer cannot act on.
 *
 * That is not hypothetical. Core's create-shipment writes `labels: input.labels
 * ?? []`, and `updateFulfillment` REPLACES the labels collection rather than
 * merging it — so marking an order shipped through the API without echoing the
 * existing labels back DELETES them. Order 83 lost its Blue Dart label that way
 * on 2026-08-17 and the customer was emailed a contentless shipped notice
 * (`noti_01M075WC7Q7SQ6KM4C6B9CH6B2`) seconds later.
 *
 * `resend-shipment-email` (#1314) already refuses this exact case, on the
 * grounds that a second wrong tracking mail is worse than the first. This is the
 * same rule on the automatic path, which had no guard at all.
 *
 * ⚠️ Skipping is not silence: the fulfillment is named in the log, and the
 * operator's recovery is to attach the waybill and run `resend-shipment-email`.
 */
export default async function shipmentCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  id: string,
  no_notification?: boolean
}>) {
  if (data.no_notification) {
    return
  }

  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query: any = container.resolve(ContainerRegistrationKeys.QUERY)

  // `labels.id` is selected alongside the scalars deliberately — the relation is
  // what decides whether the mail has anything to say.
  const { data: fulfillments } = await query.graph({
    entity: "fulfillment",
    filters: { id: data.id },
    fields: ["id", "labels.id", "labels.tracking_number"],
  })

  const labels = fulfillments?.[0]?.labels
  const hasTracking =
    Array.isArray(labels) && labels.some((l: any) => l?.tracking_number)

  if (!hasTracking) {
    logger?.error?.(
      `[shipment-created] Refusing to email the shipped notice for fulfillment ${data.id}: ` +
        `it carries no tracking number on any label, so the mail would tell the customer ` +
        `nothing they can follow. Attach the waybill, then run the ` +
        `'resend-shipment-email' maintenance job.`
    )
    return
  }

  await sendShipmentStatusEmail(container).run({
    input: {
      shipment_id: data.id,
      status: "shipped",
    },
  })
}

export const config: SubscriberConfig = {
  event: "shipment.created",
}
