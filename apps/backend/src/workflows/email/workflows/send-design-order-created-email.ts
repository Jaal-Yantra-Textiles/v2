import { createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

/**
 * Send a new design order's checkout link to its buyer.
 *
 * Shaped exactly like `send-design-order-changed-email`, and for the same
 * reason: a bare template KEY is not a rendered email. The Resend provider
 * looks for `_template_html_content` on the payload, finds none, logs a warning
 * nobody reads and sends the generic "Notification from Jaal Yantra Textiles"
 * shell — a send that succeeds, writes its row, and reports `sent: true` while
 * delivering a different message than the one the operator was shown.
 *
 * 🔴 `fetchEmailTemplateStep` THROWS when the `design-order-created` template
 * row does not exist. That is deliberate and it is the safe direction: the
 * caller (`deliverDesignOrderEmail`) turns it into an honest "not sent" with a
 * reason, and the operator still holds the link. Never soften it into a
 * fallback — the fallback is the bug above.
 */
export const sendDesignOrderCreatedEmailWorkflow = createWorkflow(
  { name: "send-design-order-created-email", store: true },
  (input: { to: string; data: Record<string, any> }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: "design-order-created",
      data: input.data,
    })

    const payload = transform({ input, templateData }, (d) => ({
      to: d.input.to,
      template: "design-order-created",
      data: d.input.data,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(payload as any)
  }
)
