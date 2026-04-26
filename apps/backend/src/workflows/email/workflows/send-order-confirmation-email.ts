import { createWorkflow, createStep, StepResponse, transform } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

const retrieveOrderStep = createStep(
  { name: "retrieve-order", store: true },
  async ({ orderId }: { orderId: string }, { container }) => {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order = await orderService.retrieveOrder(orderId, {
      relations: ["items"],
    })
    return new StepResponse(order)
  }
)

export const sendOrderConfirmationWorkflow = createWorkflow(
  { name: "send-order-confirmation-email", store: true },
  (input: { orderId: string }) => {
    const order = retrieveOrderStep(input)

    const emailData = {
      order,
      customer: order.customer_id ? { first_name: "Customer" } : null,
    }

    const templateData = fetchEmailTemplateStep({
      templateKey: "order-placed",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform({ order, emailData, templateData }, (d) => ({
      to: d.order.email || "customer@example.com",
      template: "order-placed",
      data: d.emailData,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
