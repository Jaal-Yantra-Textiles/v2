import { createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

/**
 * Tell the customer their order's designs changed (#1918).
 *
 * 🔴 This exists because the re-point path called `createNotifications` with
 * the template KEY alone. A bare key is not a rendered email: the Resend
 * provider looks for `_template_html_content` on the payload, finds none, logs
 * a warning nobody reads and falls back to the generic "Notification from Jaal
 * Yantra Textiles" shell. The send succeeded, the row was written, `email.sent`
 * was true — and the sentence the admin was shown in the confirm dialog was not
 * the sentence that went out.
 *
 * So it goes through the same two steps as every other customer email here:
 * fetch + render the DB template, then send with the rendered HTML attached.
 */
export const sendDesignOrderChangedEmailWorkflow = createWorkflow(
  { name: "send-design-order-changed-email", store: true },
  (input: { to: string; data: Record<string, any> }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: "design-order-changed",
      data: input.data,
    })

    const payload = transform({ input, templateData }, (d) => ({
      to: d.input.to,
      template: "design-order-changed",
      data: d.input.data,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(payload as any)
  }
)
