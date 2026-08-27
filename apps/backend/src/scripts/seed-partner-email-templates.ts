/**
 * Seed: Partner / admin email templates for the #332-#576-#581 email work.
 *
 * Idempotent — creates each `email_template` row only if its `template_key`
 * isn't already present (active or not). Safe to re-run. Mirrors
 * `seed-email-templates.ts` (data inlined as a const, not a JSON import, so it
 * survives the prod `medusa build` with no asset-copy dependency).
 *
 * ⚠️ Creating-only means an EDIT to a body here never reaches an environment
 * that was already seeded. Push a changed body with:
 *   TEMPLATE_KEYS=partner-production-run-cancelled DRY_RUN=1 \
 *     npx medusa exec ./src/scripts/update-email-templates.ts
 *
 * Covers the templates the merged workflows resolve by key:
 *   - partner-production-run-completed / -cancelled / -expiring
 *                                                    (#576 slice B, #1574, email_partner)
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

export const partnerEmailTemplates = [
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
      // #1574 — present ONLY when the inactivity sweep cancelled the run. An
      // admin cancel leaves them blank and the block below does not render.
      inactive_days: "Days the run sat without activity",
      inactivity_window_days: "The policy window that expired (28)",
      last_activity_at: "ISO timestamp of the last lifecycle stamp",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{partner_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Production run <strong>{{run_id}}</strong> has been <strong style="color:#dc2626">cancelled</strong>.</p>{{#if inactive_days}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">This one closed itself. The run had no recorded activity for <strong>{{inactive_days}} days</strong>, past the {{inactivity_window_days}}-day inactivity window, so it was cancelled automatically.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Idle for</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{inactive_days}} days</td></tr>{{#if last_activity_at}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Last activity</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right">{{last_activity_at}}</td></tr>{{/if}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Policy window</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right">{{inactivity_window_days}} days</td></tr></table><p style="font-size:14px;line-height:1.6;color:#3f3f46">Nothing about this counts against you, and no payment already submitted is affected. If the work is still wanted we will re-create and re-assign it — tell us and we will.</p>{{else}}{{#if notes}}<p style="font-size:13px;color:#71717a;background:#fef2f2;padding:10px 12px;border-radius:8px"><strong>Reason:</strong> {{notes}}</p>{{/if}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">No further action is needed on the run. If this was unexpected, please reach out.</p>{{/if}}{{#if run_url}}<p style="margin:20px 0"><a href="{{run_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">View run</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    // #1574 — the warning the inactivity sweep sends BEFORE it cancels.
    //
    // 🔑 The whole point of this mail is that it is ACTIONABLE: it names the
    // date, and doing anything at all on the run resets the clock. A partner
    // whose first news is the cancellation has been given a verdict, not a
    // chance.
    template_key: "partner-production-run-expiring",
    name: "Partner — Production Run Expiring (inactivity)",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject:
      "⏳ Run {{run_id}} will be cancelled in {{days_until_cancel}} days",
    variables: {
      partner_name: "Partner display name",
      run_id: "Production run id",
      run_status: "Run status (sent_to_partner | in_progress)",
      run_quantity: "Planned quantity",
      inactive_days: "Days the run has sat without activity",
      days_until_cancel: "Days left before the sweep cancels it",
      cancel_on: "Date (YYYY-MM-DD) it becomes cancellable",
      inactivity_window_days: "The policy window in days (28)",
      last_activity_at: "ISO timestamp of the last lifecycle stamp",
      run_url: "Link to the run",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{partner_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">We have not seen any movement on production run <strong>{{run_id}}</strong> for <strong>{{inactive_days}} days</strong>.</p><p style="font-size:14px;line-height:1.6;color:#3f3f46">After {{inactivity_window_days}} days without activity a run is cancelled automatically so the work can be re-assigned. This one is due to be cancelled {{#if cancel_on}}on <strong>{{cancel_on}}</strong>{{else}}shortly{{/if}} — <strong>{{days_until_cancel}} days</strong> from now.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Run</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{run_id}}</td></tr>{{#if run_quantity}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Planned</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{run_quantity}}</td></tr>{{/if}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Idle for</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{inactive_days}} days</td></tr>{{#if last_activity_at}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a">Last activity</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right">{{last_activity_at}}</td></tr>{{/if}}{{#if cancel_on}}<tr><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#b45309">Cancels on</td><td style="padding:8px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600;color:#b45309">{{cancel_on}}</td></tr>{{/if}}</table><p style="font-size:14px;line-height:1.6;color:#3f3f46"><strong>To keep it:</strong> open the run and record progress — accept it, start it, or finish it. Any of those resets the clock. If the work is blocked on us, reply to this email and it will not be cancelled.</p><p style="font-size:13px;color:#71717a;background:#f4f4f5;padding:10px 12px;border-radius:8px">If you would rather not do this run, doing nothing is fine. It will be cancelled on the date above and re-assigned — no penalty.</p>{{#if run_url}}<p style="margin:20px 0"><a href="{{run_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open run</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
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
      has_data: "bool — false when the storefront saw zero traffic this period (shows the 'start sharing' nudge instead of an all-zeros table)",
      ai_summary: "string — optional AI-authored natural-language recap of the week (renders an executive-summary callout above the KPIs when present)",
      store_url: "Storefront URL",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 4px">Hi {{partner_name}},</h1>{{#if has_data}}<p style="font-size:14px;color:#71717a;margin:0 0 16px">How <strong>{{website_name}}</strong> did over {{period_label}} ({{period_start}}–{{period_end}}).</p>{{#if ai_summary}}<div style="background:#eff6ff;border-left:3px solid #3b82f6;padding:12px 14px;border-radius:8px;margin:0 0 20px"><p style="font-size:13px;line-height:1.6;color:#1e3a8a;margin:0">{{ai_summary}}</p></div>{{/if}}<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px">{{#each kpi_rows}}<tr><td style="padding:10px 0;border-bottom:1px solid #e4e4e7;color:#71717a">{{this.label}}</td><td style="padding:10px 0;border-bottom:1px solid #e4e4e7;text-align:right;font-weight:600">{{this.value}}</td><td style="padding:10px 0 10px 12px;border-bottom:1px solid #e4e4e7;text-align:right;color:#a1a1aa;font-size:12px">{{this.arrow}} {{this.delta}}</td></tr>{{/each}}</table>{{#if top_pages}}<h2 style="font-size:14px;margin:0 0 8px">Top pages</h2><table style="width:100%;border-collapse:collapse;font-size:13px;margin:0 0 20px">{{#each top_pages}}<tr><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;color:#3f3f46">{{this.value}}</td><td style="padding:6px 0;border-bottom:1px solid #f4f4f5;text-align:right;color:#71717a">{{this.count}}</td></tr>{{/each}}</table>{{/if}}{{#if has_suggestions}}<h2 style="font-size:14px;margin:0 0 8px">Suggestions to boost sales</h2>{{#each suggestions}}<div style="background:#f4f4f5;padding:12px 14px;border-radius:8px;margin:0 0 8px"><strong style="font-size:14px">{{this.title}}</strong><p style="font-size:13px;color:#3f3f46;margin:4px 0 0;line-height:1.5">{{this.detail}}</p></div>{{/each}}{{/if}}{{#if store_url}}<p style="margin:20px 0"><a href="{{store_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Open your storefront</a></p>{{/if}}{{/if}}{{#unless has_data}}<p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 16px">Your storefront <strong>{{website_name}}</strong> is live, but it didn't get any visitors over {{period_label}} yet. Let's change that 🚀</p><div style="background:#f4f4f5;padding:16px 18px;border-radius:10px;margin:0 0 20px"><strong style="font-size:14px">Start sharing your store</strong><ul style="font-size:13px;color:#3f3f46;margin:8px 0 0;padding-left:18px;line-height:1.7"><li>Post your link on Instagram, WhatsApp &amp; your bio</li><li>Share new products with your existing customers</li><li>Add your storefront link to your email signature</li></ul></div>{{#if store_url}}<p style="margin:20px 0"><a href="{{store_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Share your storefront</a></p>{{/if}}<p style="font-size:13px;color:#71717a;line-height:1.6">Once visitors start arriving, this digest will show your traffic, top pages and tips to boost sales.</p>{{/unless}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "partner-email-verification",
    name: "Partner — Verify Your Email",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject: "Verify your email to activate your partner account",
    variables: {
      verify_url: "One-time verification deep link (partner-ui /verify-email)",
      expires_label: "Human-readable expiry, e.g. '15 minutes'",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b"><h1 style="font-size:20px;margin:0 0 12px">Confirm your email</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 20px">Welcome to Jaal Yantra Textiles. Confirm this email address to activate your partner account and start listing your work.</p><p style="margin:0 0 24px"><a href="{{verify_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Verify my email</a></p><p style="font-size:13px;line-height:1.6;color:#71717a;margin:0 0 8px">This link expires in {{expires_label}}. If it stops working, request a new one from the sign-up screen.</p><p style="font-size:12px;line-height:1.6;color:#a1a1aa;margin:0 0 20px">If the button doesn't work, paste this link into your browser:<br/><span style="color:#3f3f46;word-break:break-all">{{verify_url}}</span></p><p style="font-size:12px;color:#a1a1aa;border-top:1px solid #e4e4e7;padding-top:16px;margin:0">Didn't create a partner account? You can safely ignore this email.<br/>Jaal Yantra Textiles</p></div>`,
  },
  // #1113 S4 — designer invite. Sent when an admin mints a scoped invite with a
  // recipient email; links the designer straight to the design's moodboard.
  {
    template_key: "designer-invite",
    name: "Designer — Invitation to a Design",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject: "{{inviter_name}} invited you to design {{design_name}}",
    variables: {
      invite_url: "Designer-invite landing link (partner-ui /designer-invite/:token)",
      design_name: "The design being shared",
      inviter_name: "Who sent the invite (brand/studio)",
      expires_label: "Human-readable expiry, e.g. '7 days' or 'no expiry'",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#18181b"><h1 style="font-size:20px;margin:0 0 12px">You've been invited to design</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 8px"><strong>{{inviter_name}}</strong> invited you to collaborate on <strong>{{design_name}}</strong> at Jaal Yantra Textiles.</p><p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0 0 20px">Accept to create your designer account and open the moodboard — the brief is already waiting for you.</p><p style="margin:0 0 24px"><a href="{{invite_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:600;display:inline-block">Accept &amp; open the moodboard</a></p><p style="font-size:13px;line-height:1.6;color:#71717a;margin:0 0 8px">This invite expires in {{expires_label}}.</p><p style="font-size:12px;line-height:1.6;color:#a1a1aa;margin:0 0 20px">If the button doesn't work, paste this link into your browser:<br/><span style="color:#3f3f46;word-break:break-all">{{invite_url}}</span></p><p style="font-size:12px;color:#a1a1aa;border-top:1px solid #e4e4e7;padding-top:16px;margin:0">Weren't expecting this? You can safely ignore this email.<br/>Jaal Yantra Textiles</p></div>`,
  },
  // #859 S2 (#861) — artisan product review outcome emails. Sent by the
  // "Artisan Product Review — Email" visual flow on partner_product.approved /
  // .rejected (see scripts/seed-artisan-product-approval-flow.ts).
  {
    template_key: "artisan-product-approved",
    name: "Artisan — Product Approved",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject: "🎉 Your product is approved — {{product_title}}",
    variables: {
      partner_name: "Artisan first name (or partner name)",
      product_title: "Product title",
      product_url: "Storefront product link",
      store_url: "Storefront URL",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{partner_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Great news — your product <strong>{{product_title}}</strong> has been <strong style="color:#16a34a">approved</strong> and is now live on the store.</p>{{#if product_url}}<p style="margin:20px 0"><a href="{{product_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">View it live</a></p>{{/if}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">Thanks for listing with us. Keep adding pieces — approved products reach the whole storefront.</p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "artisan-product-rejected",
    name: "Artisan — Product Needs Changes",
    template_type: "partner",
    from: "partner@partner.jaalyantra.com",
    is_active: true,
    subject: "Changes needed on your product — {{product_title}}",
    variables: {
      partner_name: "Artisan first name (or partner name)",
      product_title: "Product title",
      reason: "Optional rejection reason from the reviewer",
      resubmit_url: "Partner-UI products link to revise + re-submit",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{partner_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Thanks for submitting <strong>{{product_title}}</strong>. It isn't approved yet — a few changes are needed before it can go live.</p>{{#if reason}}<p style="font-size:13px;color:#71717a;background:#fef2f2;padding:10px 12px;border-radius:8px"><strong>What to change:</strong> {{reason}}</p>{{/if}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">Once you've made the updates, re-submit it and we'll review again.</p>{{#if resubmit_url}}<p style="margin:20px 0"><a href="{{resubmit_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Revise &amp; re-submit</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedPartnerEmailTemplates({ container }: { container: any }) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let skipped = 0
  for (const t of partnerEmailTemplates) {
    // 🔴 NOT getTemplateByKey — it filters `is_active: true` AND `locale: "en"`,
    // so a row someone deactivated in the admin reads as absent and the seed
    // creates a SECOND row with the same key. getTemplateByKey then returns
    // `templates[0]` of an unordered list, and which body a partner receives
    // becomes a coin flip. Ask the table, not the reader.
    let exists = false
    try {
      const [rows] = await svc.listAndCountEmailTemplates({
        template_key: t.template_key,
      })
      exists = (rows?.length ?? 0) > 0
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
