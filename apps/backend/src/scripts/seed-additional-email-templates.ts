/**
 * Seed: additional customer/partner email templates (#450).
 *
 * Idempotent — creates each `email_template` row only if its `template_key`
 * isn't already present (active). Safe to re-run. Mirrors
 * `seed-partner-email-templates.ts` exactly (data inlined as a const, not a
 * JSON import, so it survives the prod `medusa build` with no asset-copy
 * dependency).
 *
 * #450 decided four template groups. Two already ship in `seed-email-templates.ts`
 * (`order-placed` = customer order-confirmation, `order-shipment-created` =
 * shipment/tracking), so this seed only adds the three genuinely-missing ones:
 *   - partner-welcome        — partner welcome / onboarding
 *   - order-feedback-request — post-delivery feedback nudge (shared with #452)
 *   - payment-receipt        — payment received / receipt (ties into #496)
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-additional-email-templates.ts
 *   # prod: ./deploy/aws/scripts/run-backfill.sh seed-additional-email-templates
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

export const additionalEmailTemplates = [
  {
    template_key: "partner-welcome",
    name: "Partner — Welcome / Onboarding",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    locale: "en",
    subject: "👋 Welcome to Jaal Yantra Textiles, {{partner_name}}",
    variables: {
      partner_name: "Partner display name",
      partner_email: "Partner login email",
      dashboard_url: "Link to the partner dashboard",
      store_url: "Partner storefront URL (optional)",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Welcome aboard, {{partner_name}} 🎉</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Your partner account is ready. From your dashboard you can manage designs, production runs, orders and your storefront — all in one place.</p><div style="background:#f4f4f5;padding:16px 18px;border-radius:10px;margin:16px 0"><strong style="font-size:14px">Getting started</strong><ul style="font-size:13px;color:#3f3f46;margin:8px 0 0;padding-left:18px;line-height:1.7"><li>Complete your profile &amp; storefront details</li><li>Add your first design and inventory</li><li>Invite teammates from the admin area</li></ul></div>{{#if dashboard_url}}<p style="margin:20px 0"><a href="{{dashboard_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open your dashboard</a></p>{{/if}}<p style="font-size:13px;color:#71717a;line-height:1.6">Signed in as <strong>{{partner_email}}</strong>. If this wasn't you, please contact us.</p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "partner-welcome",
    name: "Partner — Benvenuto / Onboarding (IT)",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    locale: "it",
    subject: "👋 Benvenuto su Jaal Yantra Textiles, {{partner_name}}",
    variables: {
      partner_name: "Nome del partner",
      partner_email: "Email di accesso del partner",
      dashboard_url: "Link al pannello di controllo del partner",
      store_url: "URL del negozio del partner (opzionale)",
      current_year: "Anno",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Benvenuto a bordo, {{partner_name}} 🎉</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Il tuo account partner è pronto. Dal tuo pannello di controllo puoi gestire design, produzione, ordini e il tuo negozio — tutto in un unico posto.</p><div style="background:#f4f4f5;padding:16px 18px;border-radius:10px;margin:16px 0"><strong style="font-size:14px">Per iniziare</strong><ul style="font-size:13px;color:#3f3f46;margin:8px 0 0;padding-left:18px;line-height:1.7"><li>Completa il tuo profilo e i dettagli del negozio</li><li>Aggiungi il tuo primo design e inventario</li><li>Invita i collaboratori dall'area di amministrazione</li></ul></div>{{#if dashboard_url}}<p style="margin:20px 0"><a href="{{dashboard_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Apri il tuo pannello di controllo</a></p>{{/if}}<p style="font-size:13px;color:#71717a;line-height:1.6">Accesso effettuato come <strong>{{partner_email}}</strong>. Se non sei stato tu, contattaci.</p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "order-feedback-request",
    name: "Customer — Post-Delivery Feedback",
    template_type: "transactional",
    from: "no-reply@jaalyantra.com",
    is_active: true,
    subject: "How did we do? Rate your order {{order_display}} ✨",
    variables: {
      customer_name: "Customer display name",
      order_id: "Order id",
      order_display: "Human-friendly order number (e.g. #1042)",
      feedback_url: "Link to the feedback / rating page",
      store_url: "Storefront URL (optional)",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{customer_name}}, your order arrived! 📦</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">We'd love to hear how <strong>{{order_display}}</strong> turned out. It only takes a few seconds — and it genuinely helps the makers behind your pieces.</p>{{#if feedback_url}}<p style="margin:20px 0;text-align:center"><a href="{{feedback_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;display:inline-block">Rate your order</a></p>{{/if}}<p style="font-size:13px;color:#71717a;line-height:1.6;text-align:center">Tap a star, tell us what you loved, or what we can do better.</p>{{#if store_url}}<p style="font-size:13px;color:#3f3f46;margin-top:20px">Looking for something new? <a href="{{store_url}}" style="color:#18181b">Browse the store →</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "payment-receipt",
    name: "Customer — Payment Receipt",
    template_type: "transactional",
    from: "no-reply@jaalyantra.com",
    is_active: true,
    subject: "🧾 Payment received — {{amount}} {{currency}}",
    variables: {
      recipient_name: "Payer / customer display name",
      amount: "Formatted amount (e.g. 1,250.00)",
      currency: "Currency code (e.g. INR)",
      payment_id: "Payment id",
      reference: "Order / invoice reference (optional)",
      paid_at: "Payment date (optional)",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Payment received ✅</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Hi {{recipient_name}}, thanks — we've received your payment. Here's your receipt.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Amount</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{amount}} {{currency}}</td></tr>{{#if reference}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Reference</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right">{{reference}}</td></tr>{{/if}}{{#if paid_at}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Date</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right">{{paid_at}}</td></tr>{{/if}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Payment ID</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-size:12px;color:#71717a">{{payment_id}}</td></tr></table><p style="font-size:13px;color:#71717a;line-height:1.6">Keep this email for your records. If anything looks off, just reply and we'll help.</p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedAdditionalEmailTemplates({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let skipped = 0
  for (const t of additionalEmailTemplates) {
    const locale = (t as any).locale ?? "en"
    const [existing] = await (svc as any).listAndCountEmailTemplates({
      template_key: t.template_key,
      locale: locale as any,
      is_active: true,
    })
    if (existing && existing.length > 0) {
      skipped++
      logger.info(`[seed-additional-email-templates] ⏭ ${t.template_key} (${locale}) exists — skip`)
      continue
    }
    await svc.createEmailTemplates([t])
    created++
    logger.info(`[seed-additional-email-templates] ✅ created ${t.template_key} (${locale})`)
  }
  logger.info(
    `[seed-additional-email-templates] done — created=${created} skipped=${skipped}`
  )
}
