/**
 * Seed: re-engagement email templates (#450).
 *
 * Idempotent — creates each `email_template` row only if its `template_key`
 * isn't already present (active). Safe to re-run. Mirrors
 * `seed-additional-email-templates.ts` exactly (data inlined as a const, not a
 * JSON import, so it survives the prod `medusa build` with no asset-copy
 * dependency).
 *
 * Four re-engagement templates:
 *   - win-back              — lapsed customer re-engagement
 *   - back-in-stock         — out-of-stock item is available again
 *   - browse-abandonment    — customer viewed products without adding to cart
 *   - feedback-reminder     — unanswered order feedback nudge
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-reengagement-email-templates.ts
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

export const reengagementEmailTemplates = [
  {
    template_key: "win-back",
    name: "Customer — Win-Back / Re-engagement",
    template_type: "marketing",
    from: "hello@jaalyantra.com",
    is_active: true,
    subject: "We miss you, {{customer_name}} 💛",
    variables: {
      customer_name: "Customer display name",
      last_order_display: "Last order display text (optional)",
      days_since: "Time since last active (e.g. '3 months') (optional)",
      discount_code: "Re-engagement discount code (optional)",
      shop_url: "Storefront URL for CTA button (optional)",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">We miss you, {{customer_name}} 💛</h1>{{#if days_since}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">It's been <strong>{{days_since}}</strong> since we last saw you — and your next favourite piece might be waiting.</p>{{/if}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">Our artisans have been busy. New handloom collections, limited editions and fresh weaves are dropping regularly.</p>{{#if last_order_display}}<p style="font-size:13px;color:#71717a;background:#f4f4f5;padding:12px 16px;border-radius:8px">Your last order was <strong>{{last_order_display}}</strong> — we'd love to see you again.</p>{{/if}}{{#if discount_code}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">Here's a little something: use code <strong style="background:#f4f4f5;padding:3px 8px;border-radius:4px">{{discount_code}}</strong> on your next order.</p>{{/if}}{{#if shop_url}}<p style="margin:20px 0;text-align:center"><a href="{{shop_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Shop the new collection</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "back-in-stock",
    name: "Customer — Back in Stock Notification",
    template_type: "transactional",
    from: "no-reply@jaalyantra.com",
    is_active: true,
    subject: "🎉 It's back — {{product_title}} is available again",
    variables: {
      customer_name: "Customer display name",
      product_title: "Product title",
      product_url: "Link to product page (optional)",
      product_image: "Product image URL (optional)",
      variant_label: "Selected variant (e.g. size/colour) (optional)",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">🎉 It's back — {{product_title}}</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Hi {{customer_name}}, great news — <strong>{{product_title}}</strong> is available again.</p>{{#if product_image}}<p style="margin:16px 0;text-align:center"><img src="{{product_image}}" alt="{{product_title}}" style="max-width:100%;border-radius:8px;max-height:320px" /></p>{{/if}}{{#if variant_label}}<p style="font-size:13px;color:#71717a;background:#f4f4f5;padding:10px 14px;border-radius:8px">You were looking at <strong>{{variant_label}}</strong>.</p>{{/if}}{{#if product_url}}<p style="margin:20px 0;text-align:center"><a href="{{product_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Get it now</a></p>{{/if}}<p style="font-size:13px;color:#71717a;line-height:1.6">Popular items tend to sell quickly — grab yours before it's gone.</p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "browse-abandonment",
    name: "Customer — Browse Abandonment",
    template_type: "marketing",
    from: "hello@jaalyantra.com",
    is_active: true,
    subject: "Still thinking it over, {{customer_name}}?",
    variables: {
      customer_name: "Customer display name",
      product_title: "Most-viewed product title (optional)",
      product_url: "Link to product page (optional)",
      product_image: "Most-viewed product image URL (optional)",
      shop_url: "Storefront URL (optional)",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Still thinking it over, {{customer_name}}?</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">We noticed you were browsing — no rush, but we wanted to make sure you didn't miss something special.</p>{{#if product_title}}{{#if product_image}}<div style="background:#f4f4f5;padding:16px;border-radius:10px;margin:16px 0"><p style="font-size:14px;font-weight:600;margin:0 0 8px">{{product_title}}</p><img src="{{product_image}}" alt="{{product_title}}" style="max-width:100%;border-radius:6px;max-height:240px;display:block" /></div>{{/if}}{{#if product_url}}<p style="margin:16px 0;text-align:center"><a href="{{product_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Take another look</a></p>{{/if}}{{/if}}{{#if shop_url}}<p style="font-size:13px;color:#3f3f46;margin-top:12px">Or <a href="{{shop_url}}" style="color:#18181b">browse everything →</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "feedback-reminder",
    name: "Customer — Feedback Reminder",
    template_type: "transactional",
    from: "no-reply@jaalyantra.com",
    is_active: true,
    subject: "A quick reminder — how was order {{order_display}}? ⭐",
    variables: {
      customer_name: "Customer display name",
      order_display: "Human-friendly order number (e.g. #1042)",
      order_id: "Order id",
      feedback_url: "Link to the feedback / rating page (optional)",
      store_url: "Storefront URL (optional)",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{customer_name}}, how was your order?</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">A quick reminder — we'd still love to hear your thoughts on <strong>{{order_display}}</strong>. It only takes a few seconds and it genuinely helps our makers.</p>{{#if feedback_url}}<p style="margin:20px 0;text-align:center"><a href="{{feedback_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;display:inline-block">Rate your order</a></p>{{/if}}<p style="font-size:13px;color:#71717a;line-height:1.6;text-align:center">Your feedback shapes everything we do. Thank you.</p>{{#if store_url}}<p style="font-size:13px;color:#3f3f46;margin-top:20px">Looking for something new? <a href="{{store_url}}" style="color:#18181b">Browse the store →</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}<br />Order {{order_id}}</p></div>`,
  },
]

export default async function seedReengagementEmailTemplates({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let skipped = 0
  for (const t of reengagementEmailTemplates) {
    let exists = false
    try {
      await svc.getTemplateByKey(t.template_key)
      exists = true
    } catch {
      exists = false
    }
    if (exists) {
      skipped++
      logger.info(`[seed-reengagement-email-templates] ⏭ ${t.template_key} exists — skip`)
      continue
    }
    await svc.createEmailTemplates([t])
    created++
    logger.info(`[seed-reengagement-email-templates] ✅ created ${t.template_key}`)
  }
  logger.info(
    `[seed-reengagement-email-templates] done — created=${created} skipped=${skipped}`
  )
}
