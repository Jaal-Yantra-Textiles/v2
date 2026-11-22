import { createWorkflow, createStep, StepResponse, transform } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { buildOrderCanceledCustomerEmailData } from "./order-canceled-customer-email-lib"
import { orderEmailBasics } from "./order-confirmation-email-lib"

const retrieveOrderStep = createStep(
  { name: "retrieve-order-for-cancellation", store: true },
  async ({ orderId }: { orderId: string }, { container }) => {
    // query.graph so totals and payments come back computed (#2578).
    const query: any = container.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "customer_id",
        "canceled_at",
        "total",
        "subtotal",
        "item_subtotal",
        "tax_total",
        "shipping_total",
        "discount_total",
        "summary",
        "items.*",
        "shipping_address.*",
        "billing_address.*",
        "shipping_methods.name",
        "payment_collections.captured_amount",
        "payment_collections.authorized_amount",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.data",
      ],
      filters: { id: orderId },
    })
    return new StepResponse(data?.[0] ?? null)
  }
)

/**
 * Send the CUSTOMER an order-cancellation email (#576 slice A).
 * Mirrors `sendOrderConfirmationWorkflow` but uses the `order-canceled` DB
 * template (active in prod) on the `email` channel (Resend). The send/skip
 * decision lives in the subscriber via `shouldSendCustomerCancellationEmail`;
 * this workflow assumes it should send.
 */
export const sendOrderCanceledCustomerEmailWorkflow = createWorkflow(
  { name: "send-order-canceled-customer-email", store: true },
  (input: { orderId: string }) => {
    const order = retrieveOrderStep(input)

    /**
     * 🔴 #2578 — the `order-canceled` template reads FLAT variables
     * ({{customer_first_name}}, {{order_display_id}}), but this sent only the
     * nested `{ order, customer }`. Every cancellation went out as
     * "Hi ," / "Your order # has been canceled" (seen on #158, 2026-11-22).
     * The flat set is the same one the confirmation uses; the nested shape is
     * kept alongside so nothing that reads it breaks.
     */
    const emailData = transform({ order }, (d) => {
      const basics = orderEmailBasics(d.order)
      return {
        ...buildOrderCanceledCustomerEmailData(d.order),
        ...basics,
        // What we hold and owe back, if anything was paid.
        refund_amount: basics.payment.paid,
      }
    })

    const templateData = fetchEmailTemplateStep({
      templateKey: "order-canceled",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform({ order, emailData, templateData }, (d) => ({
      to: d.order.email || "customer@example.com",
      template: "order-canceled",
      data: d.emailData,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
