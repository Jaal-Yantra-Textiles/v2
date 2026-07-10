import { AxiosInstance } from "axios"

/**
 * Common email templates that production subscribers/workflows expect to
 * exist. Many subscribers (order.placed, partner provisioning, design
 * production lifecycle, partner order lifecycle) throw if their template
 * is missing — which surfaces as unrelated failures in integration tests
 * that merely trigger those flows as a side effect.
 *
 * Instead of every spec re-seeding its own subset, call
 * `seedCommonEmailTemplates(api, adminHeaders)` once in `beforeAll`.
 * Seeding is idempotent: POSTs that collide with an existing key are
 * ignored, so it's safe to call from multiple suites in the shared runner.
 *
 * Keys mirror the `templateKey` values used in
 * `src/workflows/email/workflows/*`.
 */
const COMMON_EMAIL_TEMPLATES = [
  {
    name: "Admin Partner Created",
    template_key: "partner-created-from-admin",
    subject: "You're invited to set up your partner account at {{partner_name}}",
    html_content: "<div>Partner {{partner_name}} created. Temp password: {{temp_password}}</div>",
    from: "partners@jaalyantra.com",
  },
  {
    name: "Admin Investor Created",
    template_key: "investor-created-from-admin",
    subject: "You're invited to your investor portal — Jaal Yantra Textiles",
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{investor_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">You've been invited to the <strong>Jaal Yantra Textiles</strong> investor portal. Your account is ready — sign in to view companies, your holdings, and cap-table updates.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px 0 0 8px;color:#71717a;background:#f4f4f5">Temporary password</td><td style="padding:8px 12px;border:1px solid #e4e4e7;border-left:0;border-radius:0 8px 8px 0;text-align:right;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">{{temp_password}}</td></tr></table><p style="margin:20px 0"><a href="{{login_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Sign in to your portal</a></p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
    from: "investors@jaalyantra.com",
  },
  {
    name: "Design Production Started",
    template_key: "design-production-started",
    subject: "Production started for {{design_name}}",
    html_content: "<div>Production for {{design_name}} has started.</div>",
    from: "designs@jaalyantra.com",
  },
  {
    name: "Design Production Completed",
    template_key: "design-production-completed",
    subject: "Production completed for {{design_name}}",
    html_content: "<div>Production for {{design_name}} is complete.</div>",
    from: "designs@jaalyantra.com",
  },
  { name: "Order Placed", template_key: "order-placed", subject: "Your order is confirmed", html_content: "<div>Thanks for your order.</div>", from: "orders@jaalyantra.com" },
  { name: "Order Canceled", template_key: "order-canceled", subject: "Your order has been canceled", html_content: "<div>Hi {{customer.first_name}}, order {{order.id}} was canceled.</div>", from: "orders@jaalyantra.com" },
  { name: "Order Shipment Created", template_key: "order-shipment-created", subject: "Your order has shipped", html_content: "<div>Shipped.</div>", from: "orders@jaalyantra.com" },
  { name: "Order Shipment Delivered", template_key: "order-shipment-delivered", subject: "Your order was delivered", html_content: "<div>Delivered.</div>", from: "orders@jaalyantra.com" },
  { name: "Customer Created", template_key: "customer-created", subject: "Welcome", html_content: "<div>Welcome.</div>", from: "orders@jaalyantra.com" },
  { name: "Password Reset", template_key: "password-reset", subject: "Reset your password", html_content: "<div>Reset.</div>", from: "orders@jaalyantra.com" },
  { name: "Design Assigned", template_key: "design-assigned", subject: "A design was assigned", html_content: "<div>Assigned.</div>", from: "designs@jaalyantra.com" },
  { name: "Partner Order Placed", template_key: "partner-order-placed", subject: "New order", html_content: "<div>New order.</div>", from: "orders@jaalyantra.com" },
  { name: "Partner Order Fulfilled", template_key: "partner-order-fulfilled", subject: "Order fulfilled", html_content: "<div>Fulfilled.</div>", from: "orders@jaalyantra.com" },
  { name: "Partner Order Cancelled", template_key: "partner-order-cancelled", subject: "Order cancelled", html_content: "<div>Cancelled.</div>", from: "orders@jaalyantra.com" },
]

/**
 * Idempotently seed the common email templates.
 * @param api      the shared test AxiosInstance
 * @param adminHeaders `{ headers: { Authorization, ... } }` from getAuthHeaders
 */
export async function seedCommonEmailTemplates(
  api: AxiosInstance,
  adminHeaders: { headers: Record<string, string> }
): Promise<void> {
  for (const tpl of COMMON_EMAIL_TEMPLATES) {
    try {
      await api.post(
        "/admin/email-templates",
        { ...tpl, variables: {}, template_type: "email" },
        adminHeaders
      )
    } catch {
      // Already exists (duplicate key) or non-fatal — ignore.
    }
  }
}
