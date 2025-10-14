import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { sendOrderFulfillmentEmail } from "../workflows/email/send-notification-email"

export default async function orderFulfillment_createdHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  order_id: string,
  fulfillment_id: string,
  no_notification: boolean
}>) {
  // Skip notification if explicitly disabled
  if (data.no_notification) {
    return
  }

  // Send the order fulfillment email using the workflow
  await sendOrderFulfillmentEmail(container).run({
    input: {
      order_id: data.order_id,
      fulfillment_id: data.fulfillment_id,
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}