import { createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

export const sendPasswordResetWorkflow = createWorkflow(
  { name: "send-password-reset-email", store: true },
  (input: { email: string; resetUrl: string }) => {
    const emailData = {
      reset_url: input.resetUrl,
    }

    const templateData = fetchEmailTemplateStep({
      templateKey: "password-reset",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform({ input, emailData, templateData }, (d) => ({
      to: d.input.email,
      template: "password-reset",
      data: d.emailData,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
