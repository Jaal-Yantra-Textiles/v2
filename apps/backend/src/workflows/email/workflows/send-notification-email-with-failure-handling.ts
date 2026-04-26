import { createWorkflow, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { notifyOnEmailFailureStep } from "../steps/notify-on-email-failure"
import type { SendNotificationEmailInput } from "../types"

export const sendNotificationEmailWithFailureHandlingWorkflow = createWorkflow(
  { name: "send-notification-email-with-failure-handling", store: true },
  (input: SendNotificationEmailInput) => {
    // First fetch and process the email template data with the provided data
    const templateData = fetchEmailTemplateStep({ 
      templateKey: input.template,
      data: input.data
    })
    
    // Transform the input and template data together
    const combinedInput = transform({ input, templateData }, (data) => {
      return {
        ...data.input,
        templateData: data.templateData
      }
    })
    
    // Try to send the email with retry logic
    const emailResult = sendNotificationEmailStep(combinedInput)
    
    // If email sending fails, notify admin
    // This will be triggered by the compensation function if the step fails
    const failureNotification = notifyOnEmailFailureStep({
      originalTo: input.to,
      originalTemplate: input.template,
      error: "Email sending failed after retries",
      workflowName: "send-notification-email-with-failure-handling"
    })
    
    return new WorkflowResponse(emailResult)
  }
)
