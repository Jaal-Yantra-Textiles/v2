import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"
import type { ProcessedEmailTemplateData } from "../types"

interface SendNotificationEmailInput {
  to: string
  template: string
  data?: Record<string, any>
}

export const sendNotificationEmailStep = createStep(
  { 
    name: "send-notification-email", 
    store: true,
    maxRetries: 3, // Retry up to 3 times on failure
    retryInterval: 5000, // Wait 5 seconds between retries
    autoRetry: true // Enable automatic retries
  },
  async (input: SendNotificationEmailInput & { templateData?: ProcessedEmailTemplateData | null }, { container }) => {
    const notificationService = container.resolve(Modules.NOTIFICATION) as INotificationModuleService
    console.log('Send notification input:', input)
    console.log('Template data received:', input.templateData)
    
    // Prepare the data to send to the notification service
    const notificationData = {
      ...input.data,
      // Include processed template data if available
      ...(input.templateData && {
        _template_subject: input.templateData.subject,
        _template_html_content: input.templateData.html_content,
        _template_from: input.templateData.from,
        _template_processed: input.templateData.processed,
      })
    }
    
    console.log('Notification data being sent:', notificationData)

    try {
      const result = await notificationService.createNotifications({
        to: input.to,
        channel: "email",
        template: input.template,
        data: notificationData,
      })

      // Check if the notification provider failed (returns empty object)
      if (!result || !result.id) {
        throw new Error(`Email sending failed for ${input.to}. Provider returned no result.`)
      }

      return new StepResponse(result, { notificationId: result.id })
    } catch (error) {
      console.error(`Failed to send email to ${input.to}:`, error)
      // Re-throw to trigger retry mechanism
      throw error
    }
  }
)
