import { createWorkflow, createStep, StepResponse, transform } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { ICustomerModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

const retrieveCustomerForDesignStep = createStep(
  { name: "retrieve-customer-for-design", store: true },
  async ({ customerId }: { customerId: string }, { container }) => {
    const customerService = container.resolve(Modules.CUSTOMER) as ICustomerModuleService
    const customer = await customerService.retrieveCustomer(customerId)
    return new StepResponse(customer)
  }
)

export type SendDesignAssignedEmailInput = {
  customerId: string
  designName: string
  designUrl?: string
  designStatus?: string
}

export const sendDesignAssignedEmailWorkflow = createWorkflow(
  { name: "send-design-assigned-email", store: true },
  (input: SendDesignAssignedEmailInput) => {
    const customer = retrieveCustomerForDesignStep({ customerId: input.customerId })

    const emailData = {
      customer_name: customer.first_name || "Customer",
      design_name: input.designName,
      design_url: input.designUrl,
      design_status: input.designStatus,
    }

    const templateData = fetchEmailTemplateStep({
      templateKey: "design-assigned",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform({ customer, emailData, templateData }, (d) => ({
      to: d.customer.email,
      template: "design-assigned",
      data: d.emailData,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
