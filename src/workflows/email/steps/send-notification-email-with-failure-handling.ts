import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"
import type { ProcessedEmailTemplateData } from "../types"

interface SendNotificationEmailInput {
  to: string
  template: string
  data?: Record<string, any>
  originalNotificationId?: string
}

export const sendNotificationEmailWithFailureHandlingStep = createStep(
  { 
    name: "send-notification-email-with-failure-handling", 
    store: true,
    maxRetries: 3, // Retry up to 3 times on failure
    retryInterval: 5000, // Wait 5 seconds between retries
    autoRetry: true // Enable automatic retries
  },
  async (
    input: SendNotificationEmailInput & { templateData?: ProcessedEmailTemplateData | null },
    { container }
  ) => {
    const notificationService = container.resolve(Modules.NOTIFICATION) as INotificationModuleService
    console.log('Send notification input:', input)
    console.log('Template data received:', input.templateData)

    const originalNotificationId =
      input.originalNotificationId ??
      ((input.data as any)?._original_notification_id as string | undefined)
    const isRetry = Boolean((input.data as any)?._is_retry || input.originalNotificationId)
    
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
        original_notification_id: originalNotificationId,
      })

      // The result should always have an ID if successful
      // If it doesn't, the provider should have thrown an error
      if (!result || !result.id) {
        throw new Error(`Email sending failed for ${input.to}. No result returned from notification service.`)
      }

      console.log(`Email sent successfully with ID: ${result.id}`)

      if (isRetry) {
        try {
          const feedNotification = await notificationService.createNotifications({
            to: "",
            channel: "feed",
            template: "admin-ui",
            data: {
              title: "✅ Email Retried Successfully",
              description: `Successfully retried \"${input.template}\" email to ${input.to}.`,
              metadata: {
                original_notification_id: originalNotificationId,
                retried_notification_id: result.id,
                original_recipient: input.to,
                original_template: input.template,
                workflow_name: "send-notification-email-with-failure-handling",
                timestamp: new Date().toISOString(),
                severity: "info",
              },
            },
          })

          console.log(`Feed notification sent: ${feedNotification.id}`)
        } catch (feedError) {
          console.error("Failed to send success feed notification:", feedError)
        }
      }

      return new StepResponse(result, { 
        notificationId: result.id,
        emailSent: true
      })
    } catch (error) {
      console.error(`Failed to send email to ${input.to}:`, error)
      
      // Send notification to admin feed about the failure
      try {
        const feedNotification = await notificationService.createNotifications({
          to: "", // Empty for feed notifications
          channel: "feed", // Send to admin feed
          template: "admin-ui", // Use admin UI template
          data: {
            title: "🚨 Email Delivery Failed",
            description: `Failed to send "${input.template}" email to ${input.to}. Error: ${error.message}`,
            metadata: {
              original_notification_id: originalNotificationId,
              original_recipient: input.to,
              original_template: input.template,
              error_message: error.message,
              workflow_name: "send-notification-email-with-failure-handling",
              timestamp: new Date().toISOString(),
              action_required: "Please check email provider configuration",
              severity: "error"
            }
          },
        })
        
        console.log(`Feed notification sent: ${feedNotification.id}`)
      } catch (feedError) {
        console.error('Failed to send feed notification:', feedError)
      }
      
      // Re-throw the original error to trigger workflow retry mechanism
      throw error
    }
  }
)
