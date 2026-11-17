import { randomUUID } from "crypto"

import { Modules } from "@medusajs/framework/utils"
import {
  createStep,
  createWorkflow,
  StepResponse,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"

import { EMAIL_TEMPLATES_MODULE } from "../../../modules/email_templates"
import {
  CUSTOMER_LOGIN_CODE_TEMPLATE_KEY,
  customerLoginCodeEmailTemplates,
} from "../../../scripts/seed-customer-login-code-email"
import { fetchEmailTemplateStep } from "../steps/fetch-email-template"
import { redactLoginCode } from "./send-customer-login-code-email-lib"

export { REDACTED_LOGIN_CODE } from "./send-customer-login-code-email-lib"

/**
 * Create the `customer-login-code` template from its seed spec when the
 * environment has none yet — so a deploy that forgot the seed still delivers
 * codes instead of failing every sign-in on the template fetch. An existing
 * row (possibly edited by an admin) is never touched.
 */
export const ensureCustomerLoginCodeTemplateStep = createStep(
  "ensure-customer-login-code-template",
  async (_: void, { container }) => {
    const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)
    const spec = customerLoginCodeEmailTemplates[0]
    const [existing] = await svc.listAndCountEmailTemplates({
      template_key: spec.template_key,
      is_active: true,
    })
    if (existing?.length) return new StepResponse({ created: false })
    await svc.createEmailTemplates([spec])
    return new StepResponse({ created: true })
  }
)

/**
 * Sends the code email, then scrubs the code from the `notification` row.
 *
 * The notification module persists `data` (code + rendered subject/HTML)
 * before it calls the provider, so the only way to keep the plaintext out of
 * the email log is to rewrite the row after the send — on failure too, which
 * is why the row is found by a one-off idempotency key rather than the
 * (thrown-away) return value.
 */
export const sendCustomerLoginCodeNotificationStep = createStep(
  "send-customer-login-code-notification",
  async (
    input: { to: string; code: string; data: Record<string, any> },
    { container }
  ) => {
    const notifications: any = container.resolve(Modules.NOTIFICATION)
    const idempotencyKey = `customer-login-code:${randomUUID()}`

    try {
      const sent = await notifications.createNotifications({
        to: input.to,
        channel: "email",
        template: CUSTOMER_LOGIN_CODE_TEMPLATE_KEY,
        data: input.data,
        idempotency_key: idempotencyKey,
      })
      return new StepResponse({ id: sent?.id as string, status: sent?.status as string })
    } finally {
      const rows: any[] = await notifications.listNotifications({
        idempotency_key: idempotencyKey,
      })
      if (rows.length) {
        await notifications.updateNotifications(
          rows.map((row) => ({ id: row.id, data: redactLoginCode(row.data, input.code) }))
        )
      }
    }
  }
)

export type SendCustomerLoginCodeEmailInput = {
  email: string
  code: string
  expires_in_minutes: number
}

/**
 * Emails a design-studio buyer their one-time sign-in code (#2543).
 *
 * Triggered by the `auth.email_otp_requested` subscriber. Deliberately NOT a
 * stored workflow: its input holds the plaintext code, and a stored execution
 * would keep it in `workflow_execution` long after it expired. For the same
 * reason the send step redacts the code from the `notification` row.
 */
export const sendCustomerLoginCodeEmailWorkflow = createWorkflow(
  "send-customer-login-code-email",
  (input: SendCustomerLoginCodeEmailInput) => {
    ensureCustomerLoginCodeTemplateStep()

    const emailData = transform({ input }, (d) => ({
      code: d.input.code,
      expires_label: `${d.input.expires_in_minutes} minutes`,
      current_year: String(new Date().getFullYear()),
    }))

    const templateData = fetchEmailTemplateStep({
      templateKey: CUSTOMER_LOGIN_CODE_TEMPLATE_KEY,
      data: emailData as unknown as Record<string, any>,
    })

    const email = transform({ input, emailData, templateData }, (d) => ({
      to: d.input.email,
      code: d.input.code,
      data: {
        ...d.emailData,
        ...(d.templateData && {
          _template_subject: d.templateData.subject,
          _template_html_content: d.templateData.html_content,
          _template_from: d.templateData.from,
          _template_processed: d.templateData.processed,
        }),
      },
    }))

    const notification = sendCustomerLoginCodeNotificationStep(email)
    return new WorkflowResponse(notification)
  }
)
