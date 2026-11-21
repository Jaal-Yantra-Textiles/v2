import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

import { BOT_SUPPRESSED_SEND_ID } from "../../lib/bot-recipients"
import { sendNotificationEmailWorkflow } from "../email/workflows/send-notification-email"

/**
 * Tell a design-order buyer their DEPOSIT landed and that the rest is due
 * after delivery (#2568).
 *
 * Before this the buyer paid 70% and heard only the generic order
 * confirmation, which shows the full total — read as "did I just pay all of
 * it, or do I still owe something, and when?". This states the three numbers
 * and the rule: the balance is asked for once the pieces are made and
 * delivered, by a separate payment link.
 *
 * Never throws: the money has moved by the time this runs; a missing email is
 * a logged problem, not a failed order. Template key
 * `design-order-deposit-received` — a missing row throws inside the workflow
 * and is logged here.
 */
export const deliverDepositReceivedEmail = async (
  container: any,
  input: {
    orderId: string
    depositAmount: number
    total: number
    balanceAmount: number
  }
): Promise<{ sent: boolean; reason: string | null }> => {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    if (!(input.balanceAmount > 0)) {
      return { sent: false, reason: "nothing outstanding — not a partial payment" }
    }
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: ["id", "display_id", "email", "currency_code"],
      filters: { id: input.orderId },
    })
    const order = data?.[0]
    const to = String(order?.email ?? "").trim()
    if (!to) {
      logger.info?.(`[deposit-email] order ${input.orderId} has no email; nothing sent`)
      return { sent: false, reason: "no buyer email" }
    }

    const { result } = await sendNotificationEmailWorkflow(container).run({
      input: {
        to,
        template: "design-order-deposit-received",
        data: {
          order_id: order.id,
          display_id: order.display_id ?? null,
          currency_code: order.currency_code,
          deposit_amount: input.depositAmount,
          total: input.total,
          balance_amount: input.balanceAmount,
          current_year: `${new Date().getFullYear()}`,
        },
      },
    })
    if ((result as any)?.id === BOT_SUPPRESSED_SEND_ID) {
      logger.warn?.(`[deposit-email] suppressed for ${to} (order ${input.orderId})`)
      return { sent: false, reason: "recipient suppressed" }
    }
    logger.info?.(`[deposit-email] sent to ${to} for order ${input.orderId}`)
    return { sent: true, reason: null }
  } catch (e: any) {
    logger.error?.(
      `[deposit-email] NOT sent for order ${input.orderId}: ${e?.message ?? e}`
    )
    return { sent: false, reason: e?.message ?? String(e) }
  }
}
