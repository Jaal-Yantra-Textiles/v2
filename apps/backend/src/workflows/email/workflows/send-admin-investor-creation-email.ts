import { createWorkflow, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailWorkflow } from "./send-notification-email"

export const sendAdminInvestorCreationEmail = createWorkflow(
  { name: "send-admin-investor-creation-email", store: true },
  (input: { to: string; investor_name: string; temp_password: string; login_url: string }) => {
    // Reuse the generic email workflow with our specific template and data
    const result = sendNotificationEmailWorkflow.runAsStep({
      input: {
        to: input.to,
        template: "investor-created-from-admin",
        data: {
          investor_name: input.investor_name,
          temp_password: input.temp_password,
          login_url: input.login_url,
        },
      },
    })

    return new WorkflowResponse(result)
  }
)
