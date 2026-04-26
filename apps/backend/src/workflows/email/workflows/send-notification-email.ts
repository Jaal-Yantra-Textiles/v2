import { createWorkflow, WorkflowResponse, transform } from "@medusajs/framework/workflows-sdk"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import type { SendNotificationEmailInput } from "../types"

export const sendNotificationEmailWorkflow = createWorkflow(
  { name: "send-notification-email", store: true },
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
    
    // Then send the notification with the processed template data
    const result = sendNotificationEmailStep(combinedInput)
    
    return new WorkflowResponse(result)
  }
)
