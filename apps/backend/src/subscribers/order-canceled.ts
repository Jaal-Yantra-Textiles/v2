import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, Logger } from "@medusajs/types"
import { sendPartnerOrderCanceledWorkflow } from "../workflows/email/workflows/send-partner-order-email"
import { sendOrderCanceledCustomerEmailWorkflow } from "../workflows/email/workflows/send-order-canceled-customer-email"
import { shouldSendCustomerCancellationEmail } from "../workflows/email/workflows/order-canceled-customer-email-lib"

export default async function orderCanceledHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string; no_notification?: boolean }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger

  // Notify the customer about the cancellation (#576 slice A).
  // Honours the same no_notification skip semantics the fulfillment email uses.
  try {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order: any = await orderService.retrieveOrder(data.id, {
      relations: ["items"],
    })

    const decision = shouldSendCustomerCancellationEmail({
      order,
      eventNoNotification: data.no_notification,
    })

    if (decision.send) {
      await sendOrderCanceledCustomerEmailWorkflow(container).run({
        input: { orderId: data.id },
      })
    } else {
      logger.info(
        `[order.canceled] Skipped customer cancellation email for order ${data.id}: ${decision.reason}`
      )
    }
  } catch (e: any) {
    logger.warn(
      `[order.canceled] Customer notification failed for order ${data.id}: ${e?.message || e}`
    )
  }

  // Notify the partner about the cancellation
  try {
    await sendPartnerOrderCanceledWorkflow(container).run({
      input: { orderId: data.id },
    })
  } catch (e: any) {
    logger.warn(
      `[order.canceled] Partner notification failed for order ${data.id}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
