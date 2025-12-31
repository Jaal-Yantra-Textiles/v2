import { createWorkflow } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"

export const sendPasswordResetWorkflow = createWorkflow(
  { name: "send-password-reset-email", store: true },
  (input: { email: string; resetUrl: string }) => {
    sendNotificationEmailStep({
      to: input.email,
      template: "password-reset",
      data: {
        reset_url: input.resetUrl,
      },
    })
  }
)
