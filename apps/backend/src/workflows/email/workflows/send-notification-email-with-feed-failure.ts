import { createWorkflow, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { sendNotificationEmailWithFailureHandlingStep } from "../steps/send-notification-email-with-failure-handling"
import type { SendNotificationEmailInput } from "../types"

export const sendNotificationEmailWithFeedFailureWorkflow = createWorkflow(
  { name: "send-notification-email-with-feed-failure", store: true },
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
    
    // Send the email with built-in retry logic and failure handling
    // This step will automatically send feed notifications on failure
    const emailResult = sendNotificationEmailWithFailureHandlingStep(combinedInput)
    
    return new WorkflowResponse(emailResult)
  }
)
