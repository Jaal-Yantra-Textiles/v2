import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"

import { BRIEF_TEMPLATE_KEY } from "../../../scripts/seed-quote-email-template"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { sendNotificationEmailStep } from "../steps/send-notification-email"

/** #2608 — email a buyer the link to their quote brief. Same DB-template path as quotes. */
export type BriefEmailData = {
  brief_title: string
  partner_name: string
  recipient_name: string
  brief_url: string
  sample_quantity: number | null
  expires_on: string | null
  current_year: string
}

export const sendBriefEmailWorkflow = createWorkflow(
  { name: "send-brief-email", store: true },
  (input: { email: string; data: BriefEmailData }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: BRIEF_TEMPLATE_KEY,
      data: input.data as unknown as Record<string, any>,
    })
    const payload = transform({ input, templateData }, (d) => ({
      to: d.input.email,
      template: BRIEF_TEMPLATE_KEY,
      channel: "email",
      data: d.input.data as unknown as Record<string, any>,
      templateData: d.templateData,
    }))
    return new WorkflowResponse(sendNotificationEmailStep(payload as any))
  }
)

export default sendBriefEmailWorkflow
