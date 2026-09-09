import { SubscriberArgs, type SubscriberConfig } from "@medusajs/framework"
import {
  ContainerRegistrationKeys,
  Modules,
  OrderEditWorkflowEvents,
} from "@medusajs/framework/utils"
import type { IOrderModuleService, Logger } from "@medusajs/types"
import { sendOrderEditConfirmedEmailWorkflow } from "../workflows/email/workflows/send-order-edit-confirmed-email"
import {
  shouldSendOrderEditConfirmedEmail,
  type OrderEditAction,
} from "../workflows/email/workflows/order-edit-confirmed-email-lib"

/**
 * Tell the customer when an order edit is CONFIRMED — the point at which the
 * change actually lands on their order.
 *
 * Medusa emits this itself from `confirmOrderEditRequest`, carrying the change
 * `actions` and the `no_notification` flag recorded when the edit was
 * requested. Nothing listened: the order changed, the customer heard nothing,
 * and the `order-edit-confirmed` template sat active in the database with no
 * sender.
 *
 * ⚠️ `order.updated` is NOT this event — Medusa's own docblock says it excludes
 * updates made by an edit, so subscribing there would never have fired.
 *
 * Best-effort, like every other email subscriber here: the edit is already
 * committed by the time this runs, and a provider being down must not surface
 * as a failed order edit.
 */
export default async function orderEditConfirmedHandler({
  event: { data },
  container,
}: SubscriberArgs<{
  order_id: string
  actions?: OrderEditAction[]
  no_notification?: boolean
}>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
  const orderId = data?.order_id

  if (!orderId) {
    logger.warn(`[order-edit.confirmed] Event carried no order_id; skipping`)
    return
  }

  try {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order: any = await orderService.retrieveOrder(orderId, {
      relations: ["items"],
    })

    const decision = shouldSendOrderEditConfirmedEmail({
      order,
      eventNoNotification: data?.no_notification,
      actions: data?.actions,
    })

    if (!decision.send) {
      logger.info(
        `[order-edit.confirmed] Skipped customer email for order ${orderId}: ${decision.reason}`
      )
      return
    }

    await sendOrderEditConfirmedEmailWorkflow(container).run({
      input: { orderId, actions: data?.actions ?? null },
    })
  } catch (e: any) {
    logger.warn(
      `[order-edit.confirmed] Customer notification failed for order ${orderId}: ${e?.message || e}`
    )
  }
}

export const config: SubscriberConfig = {
  event: OrderEditWorkflowEvents.CONFIRMED,
}
