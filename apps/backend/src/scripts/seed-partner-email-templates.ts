/**
 * Seed: Partner / admin email templates for the #332-#576-#581 email work.
 *
 * Idempotent — creates each `email_template` row only if its `template_key`
 * isn't already present (active or not). Safe to re-run. Mirrors
 * `seed-email-templates.ts` (data inlined as a const, not a JSON import, so it
 * survives the prod `medusa build` with no asset-copy dependency).
 *
 * Covers the templates the merged workflows resolve by key:
 *   - partner-production-run-completed / -cancelled  (#576 slice B, email_partner)
 *   - region-request-admin                           (#576 slice C, email)
 *   - partner-storefront-digest                      (#581, email_partner)
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-partner-email-templates.ts
 *   # prod: ./deploy/aws/scripts/run-backfill.sh seed-partner-email-templates
 *
 * Template variables are documented per-row in `variables`. Handlebars arrays:
 *   digest `kpi_rows` = {key,label,value,delta,direction,arrow}
 *   digest `top_pages` = {value,count,unique_visitors,percentage}
 *   digest `suggestions` = {id,severity,title,detail}
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

const partnerEmailTemplates = [
  {
    template_key: "partner-production-run-completed",
    name: "Partner — Production Run Completed",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject: "✅ Production run completed — {{run_id}}",
    variables: {
      partner_name: "Partner display name",
      run_id: "Production run id",
      run_status: "Run status",
      run_quantity: "Planned quantity",
      produced_quantity: "Produced quantity",
      rejected_quantity: "Rejected quantity",
      design_id: "Design id",
      order_id: "Order id",
      notes: "Optional notes",
      run_url: "Link to the run",
      store_url: "Storefront URL",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{partner_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Production run <strong>{{run_id}}</strong> has been <strong style="color:#16a34a">completed</strong>.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Planned</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{run_quantity}}</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Produced</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{produced_quantity}}</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Rejected</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{rejected_quantity}}</td></tr></table>{{#if notes}}<p style="font-size:13px;color:#71717a;background:#f4f4f5;padding:10px 12px;border-radius:8px">{{notes}}</p>{{/if}}{{#if run_url}}<p style="margin:20px 0"><a href="{{run_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">View run</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "partner-production-run-cancelled",
    name: "Partner — Production Run Cancelled",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject: "⚠️ Production run cancelled — {{run_id}}",
    variables: {
      partner_name: "Partner display name",
      run_id: "Production run id",
      run_status: "Run status",
      notes: "Optional reason",
      run_url: "Link to the run",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{partner_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Production run <strong>{{run_id}}</strong> has been <strong style="color:#dc2626">cancelled</strong>.</p>{{#if notes}}<p style="font-size:13px;color:#71717a;background:#fef2f2;padding:10px 12px;border-radius:8px"><strong>Reason:</strong> {{notes}}</p>{{/if}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">No further action is needed on the run. If this was unexpected, please reach out.</p>{{#if run_url}}<p style="margin:20px 0"><a href="{{run_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">View run</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "region-request-admin",
    name: "Admin — Storefront Region Request",
    template_type: "transactional",
    from: "no-reply@jaalyantra.com",
    is_active: true,
    subject: "🌍 New region request: {{country_code}} — {{name}}",
    variables: {
      name: "Requester name",
      email: "Requester email",
      message: "Optional message",
      country_code: "Requested country code",
      product_handle: "Product handle (optional)",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">New region request</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">A storefront visitor asked to be served in a region you don't currently cover.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;width:120px">Country</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;font-weight:600">{{country_code}}</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Name</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7">{{name}}</td></tr><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Email</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7">{{email}}</td></tr>{{#if product_handle}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Product</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7">{{product_handle}}</td></tr>{{/if}}</table>{{#if message}}<p style="font-size:13px;color:#3f3f46;background:#f4f4f5;padding:10px 12px;border-radius:8px">{{message}}</p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">If demand for this region is real, consider adding it + enabling FX pricing.</p></div>`,
  },
  {
    template_key: "partner-storefront-digest",
    name: "Partner — Weekly Storefront Digest",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject: "📊 {{website_name}} this week — {{visitors_count}} visitors",
    variables: {
      partner_name: "Partner display name",
      website_name: "Storefront name/domain",
      period_label: "e.g. Last 7 days",
      period_start: "Window start",
      period_end: "Window end",
      visitors_count: "Unique visitors (current)",
      visitors_delta: "vs prior period",
      kpi_rows: "Array of {key,label,value,delta,direction,arrow}",
      top_pages: "Array of {value,count,unique_visitors,percentage}",
      suggestions: "Array of {id,severity,title,detail}",
      has_suggestions: "bool",
      store_url: "Storefront URL",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 4px">Hi {{partner_name}},</h1><p style="font-size:14px;color:#71717a;margin:0 0 16px">How <strong>{{website_name}}</strong> did over {{period_label}} ({{period_start}}–{{period_end}}).</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px">{{#each kpi_rows}}<tr><td style="padding:10px 0;border-bottom:1px solid #e4e4e7;color:#71717a">{{this.label}}</td><td style="padding:10px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{this.value}}</td><td style="padding:10px 0 10px 12px;border-bottom:1px solid #e4e4e7;text-align:right;color:#a1a1aa;font-size:12px">{{this.arrow}} {{this.delta}}</td></tr>{{/each}}</table>{{#if top_pages}}<h2 style="font-size:14px;margin:0 0 8px">Top pages</h2><table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 20px">{{#each top_pages}}<tr><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;color:#3f3f46">{{this.value}}</td><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;text-align:right;color:#71717a">{{this.count}}</td></tr>{{/each}}</table>{{/if}}{{#if has_suggestions}}<h2 style="font-size:14px;margin:0 0 8px">Suggestions to boost sales</h2>{{#each suggestions}}<div style="background:#f4f4f5;padding:12px 14px;border-radius:8px;margin:0 0 8px"><strong style="font-size:14px">{{this.title}}</strong><p style="font-size:13px;color:#3f3f46;margin:4px 0 0;line-height:1.5">{{this.detail}}</p></div>{{/each}}{{/if}}{{#if store_url}}<p style="margin:20px 0"><a href="{{store_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open your storefront</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedPartnerEmailTemplates({ container }: { container: any }) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let skipped = 0
  for (const t of partnerEmailTemplates) {
    let exists = false
    try {
      await svc.getTemplateByKey(t.template_key)
      exists = true
    } catch {
      exists = false
    }
    if (exists) {
      skipped++
      logger.info(`[seed-partner-email-templates] ⏭ ${t.template_key} exists — skip`)
      continue
    }
    await svc.createEmailTemplates([t])
    created++
    logger.info(`[seed-partner-email-templates] ✅ created ${t.template_key}`)
  }
  logger.info(
    `[seed-partner-email-templates] done — created=${created} skipped=${skipped}`
  )
}
