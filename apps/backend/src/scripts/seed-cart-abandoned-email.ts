/**
 * Seed: cart-abandoned email template
 *
 * Focused seeder for the single template the cart-recovery visual flow
 * relies on (key: "cart-abandoned"). The full email-templates seeder
 * (./seed-email-templates.ts) also creates this template, but running
 * the bulk seed iterates through 30+ templates — when iterating on the
 * recovery flow you typically just want this one in place.
 *
 * Idempotent: if a template with key "cart-abandoned" already exists,
 * the script reports it and exits without modifying it. Delete the row
 * (admin UI or directly in the DB) to re-seed with the latest content
 * from this file.
 *
 * Variables consumed by the recovery flow (must stay in sync with the
 * `data: { ... }` payload built in seed-cart-recovery-flow.ts):
 *   - customer_first_name   recipient's first name (or "there")
 *   - cart_url              storefront recovery URL ($STORE_URL/checkout/cart/$id)
 *   - current_year          string year for the footer copyright
 *   - unsubscribe_url       per-cart unsubscribe URL
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-cart-abandoned-email.ts
 *
 * Re-seed (after editing this file):
 *   delete the "cart-abandoned" row in the admin (Settings → Email Templates)
 *   then re-run the script.
 */

import { MedusaError } from "@medusajs/framework/utils"
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

const TEMPLATE_KEY = "cart-abandoned"

const TEMPLATE_DEFINITION = {
  name: "Abandoned Cart Reminder",
  template_key: TEMPLATE_KEY,
  from: "shop@jaalyantra.com",
  subject: "You left something beautiful behind",
  html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Your cart is waiting</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">You left some beautiful textiles behind</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">We noticed you left some items in your cart. They're still available — but they might not be for long.</p>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{cart_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px;">Complete Your Order</a>
    </div>
    <p style="color:#71717A;font-size:13px;">Need help choosing? Our team is always here.</p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
    <p style="color:#A1A1AA;font-size:10px;margin:4px 0 0;"><a href="{{unsubscribe_url}}" style="color:#A1A1AA;">Unsubscribe</a></p>
  </div>
</div></body></html>`,
  variables: {
    customer_first_name: "Customer's first name",
    cart_url: "Cart recovery URL ($STORE_URL/checkout/cart/$id)",
    current_year: "Current year (e.g. 2026)",
    unsubscribe_url: "Per-cart unsubscribe URL",
  },
  template_type: "cart_abandoned",
  is_active: true,
}

export default async function seedCartAbandonedEmail({
  container,
}: {
  container: any
}) {
  const emailTemplatesService = container.resolve(EMAIL_TEMPLATES_MODULE)

  let existing: any = null
  try {
    existing = await emailTemplatesService.getTemplateByKey(TEMPLATE_KEY)
  } catch (err: any) {
    const isMissing =
      err instanceof MedusaError && err.type === MedusaError.Types.NOT_FOUND
    if (!isMissing) {
      console.error(
        `Failed to inspect template "${TEMPLATE_KEY}": ${err.message}`,
      )
      throw err
    }
  }

  if (existing) {
    console.log(
      `Template "${TEMPLATE_KEY}" already exists (id: ${existing.id}) — skipping.`,
    )
    console.log(
      `To re-seed with updated content, delete the row in the admin UI ` +
      `(Settings → Email Templates) and re-run this script.`,
    )
    return
  }

  console.log(`Creating email template "${TEMPLATE_KEY}"...`)
  const created = await emailTemplatesService.createEmailTemplates(
    TEMPLATE_DEFINITION,
  )
  console.log(`Created: ${TEMPLATE_DEFINITION.name} (id: ${created.id})`)
  console.log(`\nVariables consumed by the recovery flow:`)
  for (const [key, desc] of Object.entries(TEMPLATE_DEFINITION.variables)) {
    console.log(`  - ${key}: ${desc}`)
  }
  console.log(
    `\nVerify the values match the cart-recovery flow's classify node ` +
    `(./seed-cart-recovery-flow.ts) before activating the flow.`,
  )
}
