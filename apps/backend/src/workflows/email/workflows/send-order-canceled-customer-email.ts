import { createWorkflow, createStep, StepResponse, transform } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { buildOrderCanceledCustomerEmailData } from "./order-canceled-customer-email-lib"

const retrieveOrderStep = createStep(
  { name: "retrieve-order-for-cancellation", store: true },
  async ({ orderId }: { orderId: string }, { container }) => {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order = await orderService.retrieveOrder(orderId, {
      relations: ["items"],
    })
    return new StepResponse(order)
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

    const emailData = transform({ order }, (d) =>
      buildOrderCanceledCustomerEmailData(d.order)
    )

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
