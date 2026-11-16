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
import { sendNotificationEmailStep } from "../steps/send-notification-email"

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
 * would keep it in `workflow_execution` long after it expired.
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
      template: CUSTOMER_LOGIN_CODE_TEMPLATE_KEY,
      data: d.emailData,
      templateData: d.templateData,
    }))

    const notification = sendNotificationEmailStep(email as any)
    return new WorkflowResponse(notification)
  }
)
