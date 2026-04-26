import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import type { Logger } from "@medusajs/types"
import { sendOrderFulfillmentEmail } from "../workflows/email/send-notification-email"
import { sendPartnerOrderFulfilledWorkflow } from "../workflows/email/workflows/send-partner-order-email"

export default async function orderFulfillment_createdHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  order_id: string,
  fulfillment_id: string,
  no_notification: boolean
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  // Skip notification if explicitly disabled
  if (data.no_notification) {
    return
  }

  // Send the order fulfillment email to customer
  await sendOrderFulfillmentEmail(container).run({
    input: {
      order_id: data.order_id,
      fulfillment_id: data.fulfillment_id,
    },
  })

  // Notify the partner
  try {
    await sendPartnerOrderFulfilledWorkflow(container).run({
      input: { orderId: data.order_id },
    })
  } catch (e: any) {
    logger.warn(
      `[order.fulfillment_created] Partner notification failed: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
}
