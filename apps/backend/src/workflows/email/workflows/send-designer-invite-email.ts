import { createWorkflow, transform } from "@medusajs/framework/workflows-sdk"
import { sendNotificationEmailStep } from "../steps/send-notification-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"

/**
 * Sends the scoped designer-invite email (#1113 S4).
 *
 * Invoked inline from `POST /admin/designs/:id/designer-invites` when the admin
 * mints an invite with a recipient email. Resolves the `designer-invite`
 * template and hands it to the shared notification email step (custom email
 * module → Resend / email_partner in prod).
 */
export const sendDesignerInviteEmailWorkflow = createWorkflow(
  { name: "send-designer-invite-email", store: true },
  (input: {
    email: string
    inviteUrl: string
    designName: string
    inviterName?: string | null
    expiresLabel?: string | null
  }) => {
    const emailData = transform({ input }, (d) => ({
      invite_url: d.input.inviteUrl,
      design_name: d.input.designName,
      inviter_name: d.input.inviterName || "The team",
      expires_label: d.input.expiresLabel || "no expiry",
    }))

    const templateData = fetchEmailTemplateStep({
      templateKey: "designer-invite",
      data: emailData as unknown as Record<string, any>,
    })

    const emailWithTemplate = transform(
      { input, emailData, templateData },
      (d) => ({
        to: d.input.email,
        template: "designer-invite",
        data: d.emailData,
        templateData: d.templateData,
      })
    )

    sendNotificationEmailStep(emailWithTemplate as any)
  }
)
