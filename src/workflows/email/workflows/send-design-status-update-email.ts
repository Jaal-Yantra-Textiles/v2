import { createWorkflow, createStep, StepResponse, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { ICustomerModuleService } from "@medusajs/types"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import designCustomerLink from "../../../links/design-customer-link"

/**
 * Resolves the customer linked to a design via design-customer-link.
 * Returns null if no customer is linked (caller should guard).
 */
const resolveCustomerFromDesignStep = createStep(
  { name: "resolve-customer-from-design", store: true },
  async ({ designId }: { designId: string }, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY) as any

    const { data: links } = await query.graph({
      entity: designCustomerLink.entryPoint,
      filters: { design_id: designId },
      fields: ["customer_id"],
      pagination: { skip: 0, take: 1 },
    })

    const customerId = links?.[0]?.customer_id
    if (!customerId) {
      return new StepResponse(null)
    }

    const customerService = container.resolve(Modules.CUSTOMER) as ICustomerModuleService
    const customer = await customerService.retrieveCustomer(customerId)

    return new StepResponse({
      id: customer.id,
      email: customer.email,
      first_name: customer.first_name,
    })
  }
)

export type SendDesignStatusUpdateEmailInput = {
  designId: string
  designName: string
  /** Email template key (e.g. "design-status-updated", "design-inventory-linked") */
  templateKey: string
  /** Current design status */
  designStatus?: string
  /** Previous design status (for status change emails) */
  previousStatus?: string
  /** Design URL for CTA in email */
  designUrl?: string
  /** Any extra data to pass to the email template */
  extraData?: Record<string, any>
}

export const sendDesignStatusUpdateEmailWorkflow = createWorkflow(
  { name: "send-design-status-update-email", store: true },
  (input: SendDesignStatusUpdateEmailInput) => {
    const customer = resolveCustomerFromDesignStep({ designId: input.designId })

    const emailData = transform({ input, customer }, (data) => {
      if (!data.customer) {
        return null
      }

      return {
        to: data.customer.email,
        template: data.input.templateKey,
        data: {
          customer_name: data.customer.first_name || "Customer",
          recipient_name: data.customer.first_name || "Customer",
          design_name: data.input.designName,
          design_status: data.input.designStatus,
          previous_status: data.input.previousStatus,
          design_url: data.input.designUrl,
          ...(data.input.extraData || {}),
        },
      }
    })

    sendNotificationEmailStep(emailData)

    return new WorkflowResponse(emailData)
  }
)
