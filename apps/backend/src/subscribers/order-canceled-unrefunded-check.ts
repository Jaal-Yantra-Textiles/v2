import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

import { findUnrefundedCaptures } from "../lib/payments/unrefunded-captures"

/**
 * #2580 — after a cancel, say out loud when captured money was NOT refunded.
 *
 * Medusa's cancel swallows a provider's refund error and still marks the order
 * refunded (see `unrefunded-captures.ts`). This reads the payment's own refund
 * rows once the cancel has finished and, for every capture without a matching
 * refund, logs an error and posts to the admin feed so a human refunds it by
 * hand. Reports only; never refunds, never throws out of the event.
 */
export default async function orderCanceledUnrefundedCheck({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data: orders } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "payment_collections.payments.id",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.currency_code",
        "payment_collections.payments.captures.amount",
        "payment_collections.payments.refunds.amount",
      ],
      filters: { id: data.id },
    })
    const order = orders?.[0]
    if (!order) return

    const payments = (order.payment_collections || []).flatMap((c: any) => c?.payments || [])
    const unrefunded = findUnrefundedCaptures(payments)
    if (!unrefunded.length) return

    const lines = unrefunded.map(
      (u) =>
        `${u.outstanding.toFixed(2)} ${String(u.currency_code || "").toUpperCase()} on ${u.payment_id} (${u.provider_id ?? "unknown provider"})`
    )
    const message = `Cancelled order #${order.display_id} (${order.id}) still holds captured money that was NOT refunded: ${lines.join("; ")}. The order may say refunded — it is not. Refund it by hand with the provider.`
    logger.error(`[order.canceled] ${message}`)

    try {
      const notifications: any = container.resolve(Modules.NOTIFICATION)
      await notifications.createNotifications([
        {
          to: "",
          channel: "feed",
          template: "admin-ui",
          data: { title: "Cancelled order was not refunded", description: message },
        },
      ])
    } catch (e: any) {
      logger.warn(`[order.canceled] unrefunded-check feed post failed: ${e?.message ?? e}`)
    }
  } catch (e: any) {
    logger.warn(`[order.canceled] unrefunded check failed for ${data.id}: ${e?.message ?? e}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
}
