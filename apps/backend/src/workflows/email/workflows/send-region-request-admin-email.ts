import {
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

/**
 * Email an admin/ops inbox about a storefront region request (#576 slice C).
 *
 * Mirrors `sendOrderCanceledCustomerEmailWorkflow` (slice A): resolves the DB
 * template `region-request-admin` and dispatches on the `email` channel
 * (Resend). The recipient + template data are decided in the route via
 * `resolveRegionRequestRecipient` / `buildRegionRequestAdminEmailData`; this
 * workflow assumes it should send.
 *
 * Best-effort by contract: `fetchEmailTemplateStep` throws when the template
 * row is absent, so the route invokes this inside a try/catch and never lets a
 * missing template fail the storefront submission (the feed notification has
 * already captured the lead).
 */
export const sendRegionRequestAdminEmailWorkflow = createWorkflow(
  { name: "send-region-request-admin-email", store: true },
  (input: { to: string; data: Record<string, any> }) => {
    const templateData = fetchEmailTemplateStep({
      templateKey: "region-request-admin",
      data: input.data,
    })

    const emailWithTemplate = transform({ input, templateData }, (d) => ({
      to: d.input.to,
      template: "region-request-admin",
      data: d.input.data,
      templateData: d.templateData,
    }))

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
