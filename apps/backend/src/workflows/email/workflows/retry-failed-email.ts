import { createWorkflow, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailWithFailureHandlingStep } from "../steps/send-notification-email-with-failure-handling"
import type { SendNotificationEmailInput } from "../types"

interface RetryFailedEmailInput {
  to: string
  template: string
  data?: Record<string, any>
  originalNotificationId?: string // Track original failure
}

export const retryFailedEmailWorkflow = createWorkflow(
  { name: "retry-failed-email", store: true },
  (input: RetryFailedEmailInput) => {
    const retryInput = transform({ input }, ({ input }) => {
      return {
        ...input,
        data: {
          ...(input.data || {}),
          _is_retry: true,
          _original_notification_id: input.originalNotificationId,
          _retry_timestamp: new Date().toISOString(),
        },
        originalNotificationId: input.originalNotificationId,
      }
    })
    
    // Use the same step with retry logic
    const result = sendNotificationEmailWithFailureHandlingStep(retryInput)
    
    return new WorkflowResponse(result)
  }
)
