import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { sendShipmentStatusEmail } from "../workflows/email/send-notification-email"

export default async function deliveryCreatedHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  id: string,
  no_notification?: boolean
}>) {
  if (data.no_notification) {
    return
  }

  await sendShipmentStatusEmail(container).run({
    input: {
      shipment_id: data.id,
      status: "delivered",
    },
  })
}

export const config: SubscriberConfig = {
  event: "delivery.created",
}