/**
 * Seed: the three emails of the customer finished-goods approval (#2463).
 *
 * - `order-approval-request`: to the customer, with the no-login link.
 * - `order-approval-balance-due`: to the customer, after approving, when the
 *   approval raised the deposit balance. Nothing else emails on
 *   `order.balance_due`, so without this the buyer is asked for money with no
 *   way to pay it.
 * - `order-approval-decided`: to our order desk (b2borders@jaalyantra.com) on either
 *   decision. Best-effort; the admin feed alert is the source of truth.
 *
 * Idempotent, like the other seeds. Prefer the maintenance job:
 *   run_maintenance_job id=seed-email-templates set=order-approval
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

export const orderApprovalEmailTemplates = [
  {
    template_key: "order-approval-request",
    name: "Customer — Approve finished goods",
    template_type: "customer",
    from: "orders@jaalyantra.com",
    is_active: true,
    locale: "en",
    subject: "Your order #{{order_display_id}} is ready for your approval",
    variables: {
      customer_name: "Customer's display name",
      order_display_id: "Order number",
      approval_url: "The no-login approve/reject page",
      note: "Optional note from us",
      ttl_days: "Days the link stays valid",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Your order #{{order_display_id}} is ready for your approval</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Hi {{customer_name}}, your pieces are finished. Please take a look at the photos and tell us if everything is right before we send them.</p>{{#if note}}<div style="background:#f4f4f5;padding:16px 18px;border-radius:10px;margin:16px 0"><p style="font-size:13px;line-height:1.7;color:#3f3f46;margin:0">{{note}}</p></div>{{/if}}<p style="margin:20px 0"><a href="{{approval_url}}" style="background:#18181b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;display:inline-block">Review and approve</a></p><p style="font-size:13px;line-height:1.6;color:#71717a">If something isn't right, you can tell us on the same page and we'll fix it. This link works for {{ttl_days}} days.</p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "order-approval-balance-due",
    name: "Customer — Balance due after approval",
    template_type: "customer",
    from: "orders@jaalyantra.com",
    is_active: true,
    locale: "en",
    subject: "Balance due for order #{{order_display_id}}",
    variables: {
      customer_name: "Customer's display name",
      order_display_id: "Order number",
      balance_amount: "The balance, formatted with currency",
      pay_url: "The balance pay link",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Thank you for approving order #{{order_display_id}}</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Hi {{customer_name}}, thank you for approving your pieces. The balance of <strong>{{balance_amount}}</strong> is now due, and we'll send your order as soon as it's paid.</p><p style="margin:20px 0"><a href="{{pay_url}}" style="background:#18181b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px;display:inline-block">Pay the balance</a></p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "order-approval-decided",
    name: "Admin — Customer answered a finished-goods approval",
    template_type: "admin",
    from: "orders@jaalyantra.com",
    is_active: true,
    locale: "en",
    subject: "{{customer_name}} {{decision}} order #{{order_display_id}}",
    variables: {
      customer_name: "Customer's display name",
      order_display_id: "Order number",
      decision: "approved | rejected",
      reason: "The customer's words",
      balance_summary: "What happened to the balance",
      admin_order_url: "Admin link to the order",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">{{customer_name}} {{decision}} order #{{order_display_id}}</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">The customer answered the finished-goods approval request.</p><div style="background:#f4f4f5;padding:16px 18px;border-radius:10px;margin:16px 0"><p style="font-size:13px;line-height:1.7;color:#3f3f46;margin:0"><strong>Decision:</strong> {{decision}}<br/>{{#if reason}}<strong>Their words:</strong> {{reason}}<br/>{{/if}}<strong>Balance:</strong> {{balance_summary}}</p></div><p style="font-size:13px;margin:18px 0 0"><a href="{{admin_order_url}}" style="color:#18181b">Open the order</a></p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedOrderApprovalEmails({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let skipped = 0
  for (const t of orderApprovalEmailTemplates) {
    const locale = (t as any).locale ?? "en"
    const [existing] = await svc.listAndCountEmailTemplates({
      template_key: t.template_key,
      locale: locale as any,
      is_active: true,
    })
    if (existing && existing.length > 0) {
      skipped++
      logger.info(
        `[seed-order-approval-emails] ⏭ ${t.template_key} (${locale}) exists — skip`
      )
      continue
    }
    await svc.createEmailTemplates([t])
    created++
    logger.info(
      `[seed-order-approval-emails] ✅ created ${t.template_key} (${locale})`
    )
  }
  logger.info(
    `[seed-order-approval-emails] done — created=${created} skipped=${skipped}`
  )
}
