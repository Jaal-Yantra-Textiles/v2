/**
 * Seed (or refresh) the email template used when a tour visitor
 * confirms their itinerary. Re-runnable.
 *
 * Run:
 *   npx medusa exec ./src/scripts/seed-tour-email-template.ts
 */

import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"

const TEMPLATE_KEY = "tour-itinerary-confirmation"
const TEMPLATE_NAME = "Tour itinerary confirmation"

const SUBJECT = "Your visit is set — {{tour_title}} on {{formatDate tour_date}}"

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>{{tour_title}}</title></head>
<body style="margin:0;padding:0;background:#f7f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,sans-serif;color:#2a2620;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f5f0;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #e5e0d3;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 32px 8px;">
          <p style="margin:0;font-style:italic;color:#9a5b3f;font-size:14px;">Confirmed</p>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.25;color:#2a2620;">We've got your day, {{first_name}}.</h1>
          <p style="margin:12px 0 0;font-size:14px;line-height:1.6;color:#5a534a;">{{tour_title}} on {{formatDate tour_date}}.</p>
        </td></tr>

        <tr><td style="padding:24px 32px 8px;">
          <h2 style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8e7c;">Your itinerary</h2>
          <ul style="margin:12px 0 0;padding:0;list-style:none;">
            {{#each segments}}
            <li style="padding:10px 0;border-bottom:1px solid #f0ebe0;font-size:14px;color:#2a2620;">
              {{title}}{{#if duration}} <span style="color:#9a8e7c;">· {{duration}}</span>{{/if}}{{#if required}} <span style="color:#9a5b3f;">· always included</span>{{/if}}
            </li>
            {{/each}}
          </ul>
        </td></tr>

        {{#if has_payment}}
        <tr><td style="padding:24px 32px 8px;">
          <h2 style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8e7c;">Payment</h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">
            {{#if paid_amount}}
            <tr><td style="padding:6px 0;font-size:14px;color:#5a534a;">Paid via {{paid_provider}}</td>
                <td style="padding:6px 0;text-align:right;font-family:ui-monospace,monospace;color:#2a2620;">{{formatMoney paid_currency paid_amount}}</td></tr>
            {{/if}}
            <tr><td style="padding:6px 0;font-size:14px;color:#5a534a;">Add-ons today</td>
                <td style="padding:6px 0;text-align:right;font-family:ui-monospace,monospace;color:#2a2620;">{{formatMoney add_ons_currency add_ons_amount}}</td></tr>
          </table>
          <p style="margin:8px 0 0;font-size:12px;color:#9a8e7c;">Add-ons settle on the day with your guide — cash or card.</p>
        </td></tr>
        {{/if}}

        <tr><td style="padding:24px 32px;">
          <h2 style="margin:0;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;color:#9a8e7c;">What happens next</h2>
          <ol style="margin:12px 0 0;padding:0 0 0 18px;color:#2a2620;font-size:14px;line-height:1.7;">
            <li>This email is your receipt — keep it safe.</li>
            <li>Your guide will reach out about 48 hours before with the meeting point.</li>
            <li>Show up, we host. Add-ons settle on the day.</li>
          </ol>
        </td></tr>

        <tr><td style="padding:0 32px 32px;">
          <a href="{{visit_url}}" style="display:inline-block;background:#9a5b3f;color:#ffffff;text-decoration:none;font-weight:500;font-size:14px;padding:12px 20px;border-radius:999px;">Open my visit</a>
          <p style="margin:12px 0 0;font-size:12px;color:#9a8e7c;">You can come back to this link anytime to change your selections.</p>
        </td></tr>
      </table>
      <p style="margin:16px 0 0;font-size:12px;color:#9a8e7c;font-style:italic;">Jaal Yantra Textiles · supporting artisans across the world.</p>
    </td></tr>
  </table>
</body></html>`

/**
 * Full template spec — exported so the #457 Data Plumbing `seed-email-templates`
 * maintenance job can preview/create it idempotently without `medusa exec`.
 */
export const tourEmailTemplate = {
  name: TEMPLATE_NAME,
  description:
    "Sent to the customer when they confirm their tour itinerary on the visit page.",
  template_key: TEMPLATE_KEY,
  subject: SUBJECT,
  html_content: HTML,
  is_active: true,
  template_type: "transactional",
  variables: {
    first_name: "string",
    tour_title: "string",
    tour_date: "ISO date",
    visit_url: "string",
    segments: "Array<{ title, duration?, required? }>",
    has_payment: "boolean",
    paid_provider: "string",
    paid_amount: "number",
    paid_currency: "ISO 4217",
    add_ons_amount: "number",
    add_ons_currency: "ISO 4217",
  },
}

export default async function seedTourEmailTemplate({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const templates: any = container.resolve(EMAIL_TEMPLATES_MODULE)

  const [existing] = await templates.listAndCountEmailTemplates(
    { template_key: TEMPLATE_KEY },
    { take: 1 }
  )
  const current = existing?.[0]

  const fields = tourEmailTemplate

  if (current) {
    await templates.updateEmailTemplates({ id: current.id, ...fields })
    logger.info(`Updated email template ${current.id} (${TEMPLATE_KEY})`)
  } else {
    const created = await templates.createEmailTemplates(fields)
    logger.info(`Created email template ${created.id} (${TEMPLATE_KEY})`)
  }
}
