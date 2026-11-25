/**
 * Buyer emails for the design-order follow-up (`design-order-followup` job):
 * a gentle day-3 reminder and a day-6 last call. Day 7 reuses the existing
 * `design-order-cancelled` template with a buyer_message.
 *
 * Seeded from Settings → Data Plumbing: seed-email-templates, set
 * "design-order-followup". Data: customer_first_name, items[{title}],
 * checkout_url, close_on, current_year.
 */
const shell = (title: string, body: string) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">${title}</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Jaal Yantra Textiles</p>
  </div>
  <div style="padding:32px;">
${body}
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} Jaal Yantra Textiles</p>
  </div>
</div></body></html>`

const P = `style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;"`
const BUTTON = `<div style="text-align:center;margin:28px 0;">
      <a href="{{checkout_url}}" style="background:#18181B;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;display:inline-block;">Review and pay</a>
    </div>`
const ITEMS = `<ul style="color:#18181B;font-size:14px;line-height:1.8;margin:12px 0;padding-left:20px;">
      {{#each items}}<li>{{title}}</li>{{/each}}
    </ul>`

const VARIABLES = {
  customer_first_name: "Buyer's first name (or 'there')",
  items: "Pieces on the order: [{ title }]",
  checkout_url: "Link to review and pay the design order",
  close_on: "Date the order closes if unpaid, e.g. '2 December 2026'",
  current_year: "Current year",
}

export const designOrderFollowupEmailTemplates = [
  {
    name: "Design Order Reminder",
    template_key: "design-order-reminder",
    description:
      "Day 3 of an unpaid design order: a gentle reminder that explains how it works and when it closes. Sent by the design-order-followup job.",
    from: "orders@jaalyantra.com",
    subject: "Your design order is ready when you are",
    html_content: shell(
      "Your design order is ready when you are",
      `    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p ${P}>A few days ago we put together your design order:</p>
    ${ITEMS}
    <p ${P}>Nothing is cut or woven until you confirm, so there is no rush. Here is how it works:</p>
    <ol style="color:#52525B;font-size:14px;line-height:1.8;margin:12px 0;padding-left:20px;">
      <li>You review the order and pay through the link below.</li>
      <li>We hand your pieces to the people making them, and send you updates as they take shape.</li>
      <li>We pack them and ship them to you.</li>
    </ol>
    ${BUTTON}
    <p ${P}>We will keep this order open until <strong>{{close_on}}</strong>. After that we close it, and if you still want the pieces, just reply to this email and we will make you a fresh one.</p>
    <p style="color:#71717A;font-size:13px;margin:12px 0 0;">Any question about sizes, fabric or timing? Reply here and it reaches the people who prepared your order.</p>`
    ),
    variables: VARIABLES,
    template_type: "general",
    is_active: true,
  },
  {
    name: "Design Order Last Call",
    template_key: "design-order-last-call",
    description:
      "Day 6 of an unpaid design order: a short note that it closes tomorrow. Sent by the design-order-followup job.",
    from: "orders@jaalyantra.com",
    subject: "Your design order closes on {{close_on}}",
    html_content: shell(
      "Your design order closes soon",
      `    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p ${P}>A short note: your design order closes on <strong>{{close_on}}</strong>.</p>
    ${ITEMS}
    <p ${P}>If you would like to go ahead, you can review and pay here:</p>
    ${BUTTON}
    <p ${P}>If now is not the right time, that is completely fine. We will close the order, your designs stay with us, and you can reply to this email whenever you are ready to start a new one.</p>`
    ),
    variables: VARIABLES,
    template_type: "general",
    is_active: true,
  },
]
