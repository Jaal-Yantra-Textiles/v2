import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { Modules } from "@medusajs/framework/utils"
import type { INotificationModuleService } from "@medusajs/types"

interface EmailFailureNotificationInput {
  originalTo: string
  originalTemplate: string
  error: string
  workflowName: string
}

export const notifyOnEmailFailureStep = createStep(
  { name: "notify-on-email-failure", store: true },
  async (input: EmailFailureNotificationInput, { container }) => {
    const notificationService = container.resolve(Modules.NOTIFICATION) as INotificationModuleService
    
    // Send notification to admin feed instead of email
    const feedNotification = await notificationService.createNotifications({
      to: "", // Empty for feed notifications
      channel: "feed", // Send to admin feed
      template: "admin-ui", // Use admin UI template
      data: {
        title: "🚨 Email Delivery Failed",
        description: `Failed to send "${input.originalTemplate}" email to ${input.originalTo}. Error: ${input.error}`,
        // Additional metadata for the notification
        metadata: {
          original_recipient: input.originalTo,
          original_template: input.originalTemplate,
          error_message: input.error,
          workflow_name: input.workflowName,
          timestamp: new Date().toISOString(),
          action_required: "Please check email provider configuration",
          severity: "error"
        }
      },
    })

    return new StepResponse(feedNotification, { 
      feedNotificationId: feedNotification.id,
      failureLoggedAt: new Date()
    })
  }
)
