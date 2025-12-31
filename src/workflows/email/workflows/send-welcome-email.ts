import { createWorkflow, createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { ICustomerModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"

const retrieveCustomerStep = createStep(
  { name: "retrieve-customer", store: true },
  async ({ customerId }: { customerId: string }, { container }) => {
    const customerService = container.resolve(Modules.CUSTOMER) as ICustomerModuleService
    const customer = await customerService.retrieveCustomer(customerId)
    return new StepResponse(customer)
  }
)

export const sendWelcomeEmailWorkflow = createWorkflow(
  { name: "send-welcome-email", store: true },
  (input: { customerId: string }) => {
    const customer = retrieveCustomerStep(input)
    
    sendNotificationEmailStep({
      to: customer.email,
      template: "customer-created",
      data: {
        customer_name: customer.first_name || "Customer",
        customer,
      },
    })
  }
)
