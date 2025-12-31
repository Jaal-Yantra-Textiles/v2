import { createWorkflow, createStep, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService, IFulfillmentModuleService } from "@medusajs/types"
import { sendNotificationEmailWorkflow } from "./send-notification-email"

const retrieveOrderDataStep = createStep(
  { name: "retrieve-order-fulfillment-data", store: true },
  async ({ order_id, fulfillment_id }: { order_id: string; fulfillment_id: string }, { container }) => {
    const orderService = container.resolve(Modules.ORDER) as IOrderModuleService
    const fulfillmentService = container.resolve(Modules.FULFILLMENT) as IFulfillmentModuleService
    
    // Retrieve order with shipping address
    const order = await orderService.retrieveOrder(order_id, {
      relations: ["shipping_address"],
    })
    
    // Retrieve the specific fulfillment with its items
    const fulfillment = await fulfillmentService.retrieveFulfillment(fulfillment_id, {
      relations: ["items"],
    })
    
    return new StepResponse({
      order,
      fulfillment,
      customer_email: order.email || "",
      customer_name: "Customer",
    })
  }
)

export const sendOrderFulfillmentEmail = createWorkflow(
  { name: "send-order-fulfillment-email", store: true },
  (input: { order_id: string; fulfillment_id: string }) => {
    const orderData = retrieveOrderDataStep(input)
    
    // Transform to prepare email data
    const emailInput = transform({ orderData }, (data) => ({
      to: data.orderData.customer_email,
      template: "order-fulfillment-procured",
      data: {
        customer_name: data.orderData.customer_name,
        order_id: data.orderData.order.display_id || data.orderData.order.id,
        order_date: data.orderData.order.created_at,
        // Use fulfillment items instead of all order items
        items: data.orderData.fulfillment.items || [],
        fulfillment_id: data.orderData.fulfillment.id,
        shipping_address: data.orderData.order.shipping_address,
        // Additional fulfillment details
        total_items_fulfilled: data.orderData.fulfillment.items?.length || 0,
      },
    }))
    
    const result = sendNotificationEmailWorkflow.runAsStep({
      input: emailInput,
    })

    return new WorkflowResponse(result)
  }
)
