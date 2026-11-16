/**
 * Seed: the design-studio sign-in code email (#2543, phase 2).
 *
 * `customer-login-code` carries the 6-digit one-time code a buyer types into
 * the "Verify your email" panel on cicilabel.com/design. Sent by
 * `sendCustomerLoginCodeWorkflow` (subscriber `customer-email-otp-requested`).
 *
 * Idempotent. The send workflow also creates this row on first use if it is
 * missing (ensureEmailTemplateStep), so a fresh environment needs no manual
 * step; this seed / the maintenance job exist so the row can be created (and
 * then edited in Settings → Email templates) before the first buyer signs in:
 *   run_maintenance_job id=seed-email-templates set=customer-login-code
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

export const CUSTOMER_LOGIN_CODE_TEMPLATE_KEY = "customer-login-code"

export const customerLoginCodeEmailTemplates = [
  {
    template_key: CUSTOMER_LOGIN_CODE_TEMPLATE_KEY,
    name: "Customer — Design studio sign-in code",
    template_type: "customer",
    from: "designs@jaalyantra.com",
    is_active: true,
    locale: "en",
    subject: "{{code}} is your Cici Label sign-in code",
    variables: {
      code: "The 6-digit one-time code",
      expires_label: "How long the code works, e.g. '10 minutes'",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Your sign-in code</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 16px">Type this code in the design studio to confirm your email and keep your designs with you.</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:0 0 16px;font-family:SFMono-Regular,Menlo,Consolas,monospace">{{code}}</p><p style="font-size:13px;line-height:1.6;color:#71717a;margin:0 0 8px">It works once, for {{expires_label}}.</p><p style="font-size:12px;color:#a1a1aa;border-top:1px solid #e4e4e7;padding-top:16px;margin:20px 0 0">Didn't ask for this? Someone may have typed your email by mistake. You can ignore this email; nobody can sign in without the code.<br/>Cici Label · Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedCustomerLoginCodeEmail({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  for (const t of customerLoginCodeEmailTemplates) {
    const [existing] = await svc.listAndCountEmailTemplates({
      template_key: t.template_key,
      locale: t.locale as any,
      is_active: true,
    })
    if (existing && existing.length > 0) {
      logger.info(`[seed-customer-login-code-email] ⏭ ${t.template_key} exists — skip`)
      continue
    }
    await svc.createEmailTemplates([t])
    logger.info(`[seed-customer-login-code-email] ✅ created ${t.template_key}`)
  }
}
