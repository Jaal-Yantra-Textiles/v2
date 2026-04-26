import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailWorkflow } from "./send-notification-email"

export const sendAdminPartnerCreationEmail = createWorkflow(
  { name: "send-admin-partner-creation-email", store: true },
  (input: { to: string; partner_name: string; temp_password: string }) => {
    // Reuse the generic email workflow with our specific template and data
    const result = sendNotificationEmailWorkflow.runAsStep({
      input: {
        to: input.to,
        template: "partner-created-from-admin",
        data: {
          partner_name: input.partner_name,
          temp_password: input.temp_password,
        },
      },
    })

    return new WorkflowResponse(result)
  }
)
