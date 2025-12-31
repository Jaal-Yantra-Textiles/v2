import { createWorkflow, createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"

const retrieveOrderStep = createStep(
  { name: "retrieve-order", store: true },
  async ({ orderId }: { orderId: string }, { container }) => {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const order = await orderService.retrieveOrder(orderId, {
      relations: ["customer", "items"],
    })
    return new StepResponse(order)
  }
)

export const sendOrderConfirmationWorkflow = createWorkflow(
  { name: "send-order-confirmation-email", store: true },
  (input: { orderId: string }) => {
    const order = retrieveOrderStep(input)
    
    sendNotificationEmailStep({
      to: order.email || "customer@example.com",
      template: "order-placed",
      data: {
        order,
        customer: order.customer_id ? { first_name: "Customer" } : null,
      },
    })
  }
)
