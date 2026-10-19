import {
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

/**
 * Email a shopper the full production story of a piece they asked about on
 * the product page (DB template `production-story`). The data is built by
 * `buildStoryEmailData`; this workflow assumes it should send.
 *
 * `fetchEmailTemplateStep` throws when the template row is absent, so the
 * share route runs this in a try/catch and reports `sent: false` instead of
 * failing the request (the admin feed has already captured the lead).
 */
export const sendProductionStoryEmailWorkflow = createWorkflow(
  { name: "send-production-story-email", store: true },
  (input: { to: string; data: Record<string, any> }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: "production-story",
      data: input.data,
    })

    const emailWithTemplate = transform({ input, templateData }, (d) => ({
      to: d.input.to,
      template: "production-story",
      data: d.input.data,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
