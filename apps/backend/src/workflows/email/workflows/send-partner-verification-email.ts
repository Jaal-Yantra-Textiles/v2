import { createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

/**
 * Sends the partner email-verification message.
 *
 * Triggered by the `auth.verification_requested` subscriber after Medusa's
 * native verification flow generates a one-time code. Resolves the
 * `partner-email-verification` template and hands it to the shared
 * notification email step (custom email module → Resend).
 */
export const sendPartnerVerificationEmailWorkflow = createWorkflow(
  { name: "send-partner-verification-email", store: true },
  (input: {
    email: string
    verifyUrl: string
    expiresMinutes: number | null
  }) => {
    const emailData = transform({ input }, (d) => ({
      verify_url: d.input.verifyUrl,
      // Handlebars-friendly copy: "15 minutes" or a sensible fallback.
      expires_label:
        d.input.expiresMinutes && d.input.expiresMinutes > 0
          ? `${d.input.expiresMinutes} minutes`
          : "a short while",
    }))

    const templateData = fetchEmailTemplateStep({
      templateKey: "partner-email-verification",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform(
      { input, emailData, templateData },
      (d) => ({
        to: d.input.email,
        template: "partner-email-verification",
        data: d.emailData,
        templateData: d.templateData,
      })
    )

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
