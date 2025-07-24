import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderConfirmationWorkflow } from "../workflows/email/send-notification-email"

export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  // Execute the order confirmation email workflow
  await sendOrderConfirmationWorkflow(container).run({
    input: {
      orderId: data.id,
    },
  })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
