import { createWorkflow, createStep, StepResponse, transform } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { ICustomerModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

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

    const emailData = {
      customer_name: customer.first_name || "Customer",
      customer,
    }

    const templateData = fetchEmailTemplateStep({
      templateKey: "customer-created",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform({ customer, emailData, templateData }, (d) => ({
      to: d.customer.email,
      template: "customer-created",
      data: d.emailData,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
