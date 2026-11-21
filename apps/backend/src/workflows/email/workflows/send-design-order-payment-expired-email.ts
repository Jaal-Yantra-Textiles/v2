import { createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

/**
 * Tell a design-order buyer their PayU payment link expired (#2564).
 *
 * Same shape as `send-design-order-created-email`, for the same reason: a bare
 * template key is not a rendered email. `fetchEmailTemplateStep` THROWS when
 * the `design-order-payment-expired` row is missing — the sweep job then leaves
 * the cart un-notified and retries next run, rather than sending a generic shell.
 */
export const sendDesignOrderPaymentExpiredEmailWorkflow = createWorkflow(
  { name: "send-design-order-payment-expired-email", store: true },
  (input: { to: string; data: Record<string, any> }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: "design-order-payment-expired",
      data: input.data,
    })

    const payload = transform({ input, templateData }, (d) => ({
      to: d.input.to,
      template: "design-order-payment-expired",
      data: d.input.data,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(payload as any)
  }
)
