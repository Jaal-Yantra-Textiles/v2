import { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, PaymentEvents } from "@medusajs/framework/utils"

import { sendRefundEmailForPayment } from "../lib/payments/order-refund-email"

/**
 * #2645: tell the buyer when we refund them.
 *
 * Core's `refundPaymentWorkflow` (the admin Refund button, the partner refund
 * route) emits `payment.refunded` with ONLY the payment id. The sender
 * resolves payment -> order, emails the newest refund once (stamped on
 * `order.metadata.refund_emails_sent`, so a redelivered event does not
 * double-send), and never throws out of the event.
 *
 * 🔑 A cancel's refunds go through `refundPaymentsWorkflow`, which emits no
 * event; the cancellation email covers those.
 */
export default async function paymentRefundedEmail({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger: any = container.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    if (!data?.id) return
    const out = await sendRefundEmailForPayment(container, data.id)
    if (!out.sent) {
      logger.info?.(`[payment.refunded] no refund email for payment ${data.id}: ${out.reason}`)
    }
  } catch (e: any) {
    logger.error?.(`[payment.refunded] refund email for payment ${data?.id} failed: ${e?.message ?? e}`)
  }
}

export const config: SubscriberConfig = {
  event: PaymentEvents.REFUNDED,
  context: { subscriberId: "payment-refunded-email" },
}
