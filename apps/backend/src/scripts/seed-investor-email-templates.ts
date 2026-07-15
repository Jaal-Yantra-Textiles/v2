/**
 * Seed: Investor email templates (#969 — invite-only investor onboarding).
 *
 * Idempotent — creates each `email_template` row only if its `template_key`
 * isn't already present. Safe to re-run. Mirrors `seed-partner-email-templates.ts`
 * (data inlined as a const, not a JSON import, so it survives the prod
 * `medusa build` with no asset-copy dependency).
 *
 * Covers the template the invite chain resolves by key:
 *   - investor-created-from-admin  (admin provisions an investor → temp password)
 *     resolved via `send-admin-investor-creation-email` → `sendNotificationEmailWorkflow`.
 *
 * Without this row present in prod, the invite email step throws AFTER the 201
 * (the investor account is still created; the temp password is only logged
 * server-side). Load it via data plumbing:
 *
 *   npx medusa exec ./src/scripts/seed-investor-email-templates.ts
 *   # prod: ./deploy/aws/scripts/run-backfill.sh seed-investor-email-templates
 *
 * Handlebars variables passed by the workflow: investor_name, temp_password,
 * login_url. `current_year` is filled by the notification workflow.
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

export const investorEmailTemplates = [
  {
    template_key: "investor-created-from-admin",
    name: "Investor — Portal Invitation",
    template_type: "investor",
    from: "investors@jaalyantra.com",
    is_active: true,
    subject: "You're invited to your investor portal — Jaal Yantra Textiles",
    variables: {
      investor_name: "Investor display name",
      temp_password: "One-time temporary password",
      login_url: "Investor portal sign-in URL",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{investor_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">You've been invited to the <strong>Jaal Yantra Textiles</strong> investor portal. Your account is ready — sign in to view companies, your holdings, and cap-table updates.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 12px;border:1px solid #e4e4e7;border-radius:8px 0 0 8px;color:#71717a;background:#f4f4f5">Temporary password</td><td style="padding:8px 12px;border:1px solid #e4e4e7;border-left:0;border-radius:0 8px 8px 0;text-align:right;font-weight:600;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">{{temp_password}}</td></tr></table><p style="margin:20px 0"><a href="{{login_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block">Sign in to your portal</a></p><p style="font-size:13px;line-height:1.6;color:#71717a">Sign in with your email address and the temporary password above. For your security, please change your password after your first sign-in. If the button doesn't work, copy this link into your browser:<br/><span style="color:#3f3f46">{{login_url}}</span></p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">If you weren't expecting this invitation, you can safely ignore this email.</p><p style="font-size:12px;color:#a1a1aa;margin-top:12px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "investor-referral-team",
    name: "Investor — Referral (team notification)",
    template_type: "investor",
    from: "investors@jaalyantra.com",
    is_active: true,
    subject: "New investor referral: {{invitee_name}} (via {{referrer_name}})",
    variables: {
      referrer_name: "Investor who sent the referral",
      referrer_email: "Referrer email",
      invitee_name: "Person being invited",
      invitee_email: "Invitee email",
      access_level: "Requested access level (Investor / View-only)",
      note: "Optional message from the referrer",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">New investor referral</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46"><strong>{{referrer_name}}</strong> ({{referrer_email}}) has invited someone to the investor portal. Follow up to onboard them.</p><table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0"><tr><td style="padding:8px 12px;border:1px solid #e4e4e7;color:#71717a;background:#f4f4f5">Name</td><td style="padding:8px 12px;border:1px solid #e4e4e7;border-left:0;text-align:right;font-weight:600">{{invitee_name}}</td></tr><tr><td style="padding:8px 12px;border:1px solid #e4e4e7;border-top:0;color:#71717a;background:#f4f4f5">Email</td><td style="padding:8px 12px;border:1px solid #e4e4e7;border-left:0;border-top:0;text-align:right">{{invitee_email}}</td></tr><tr><td style="padding:8px 12px;border:1px solid #e4e4e7;border-top:0;color:#71717a;background:#f4f4f5">Access level</td><td style="padding:8px 12px;border:1px solid #e4e4e7;border-left:0;border-top:0;text-align:right">{{access_level}}</td></tr></table>{{#if note}}<p style="font-size:13px;line-height:1.6;color:#71717a">Note from referrer: {{note}}</p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
  {
    template_key: "investor-referral-friend",
    name: "Investor — Referral (invitee heads-up)",
    template_type: "investor",
    from: "investors@jaalyantra.com",
    is_active: true,
    subject: "{{referrer_name}} invited you to Jaal Yantra Textiles",
    variables: {
      invitee_name: "Person being invited",
      referrer_name: "Investor who referred them",
      access_level: "Access level they were invited with",
      note: "Optional message from the referrer",
      portal_url: "Investor portal URL",
      current_year: "Year",
    },
    html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{invitee_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46"><strong>{{referrer_name}}</strong> thought you'd be interested in <strong>Jaal Yantra Textiles</strong> and invited you to our investor portal as a <strong>{{access_level}}</strong>.</p>{{#if note}}<p style="font-size:14px;line-height:1.6;color:#3f3f46;font-style:italic">"{{note}}"</p>{{/if}}<p style="font-size:14px;line-height:1.6;color:#3f3f46">Our team will reach out shortly to set up your access. No action is needed right now — this is just a heads-up.</p>{{#if portal_url}}<p style="font-size:13px;line-height:1.6;color:#71717a">Learn more about the portal: <a href="{{portal_url}}" style="color:#3f3f46">{{portal_url}}</a></p>{{/if}}<p style="font-size:12px;color:#a1a1aa;margin-top:24px">If this wasn't expected, you can safely ignore this email.</p><p style="font-size:12px;color:#a1a1aa;margin-top:12px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
  },
]

export default async function seedInvestorEmailTemplates({ container }: { container: any }) {
  const logger = container.resolve("logger")
  const svc: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  let created = 0
  let updated = 0
  for (const t of investorEmailTemplates) {
    let existing: any = null
    try {
      existing = await svc.getTemplateByKey(t.template_key)
    } catch {
      existing = null
    }
    // Upsert: the template body lives in the DB, so shipping a fix to the HTML
    // (e.g. the Handlebars note/portal guards) must refresh the existing row —
    // a create-only seed would leave prod on the stale copy.
    if (existing?.id) {
      await svc.updateEmailTemplates({ id: existing.id, ...t })
      updated++
      logger.info(`[seed-investor-email-templates] ♻ updated ${t.template_key}`)
      continue
    }
    await svc.createEmailTemplates([t])
    created++
    logger.info(`[seed-investor-email-templates] ✅ created ${t.template_key}`)
  }
  logger.info(
    `[seed-investor-email-templates] done — created=${created} updated=${updated}`
  )
}
