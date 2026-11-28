/**
 * Buyer email for Bitcoin checkouts.
 *
 * `bitcoin-payment-received` — BTCPay has seen the buyer's payment but the
 * network has not confirmed it yet (invoice status Processing). Bitcoin takes
 * 10–60 min to confirm, and the buyer has usually closed the page by then, so
 * this tells them the money arrived and the order follows on its own. Sent
 * once per invoice by the `complete-paid-bitcoin-carts` job. The order
 * confirmation email follows when it confirms.
 *
 * (The Bitcoin REFUND email is the shared `order-refunded` template, which
 * switches to "ready to claim" wording when `bitcoin_claim_link` is set.)
 *
 * Seeded from Settings → Data Plumbing: seed-email-templates, set "bitcoin".
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

export const BITCOIN_PAYMENT_RECEIVED_TEMPLATE = "bitcoin-payment-received"

export const bitcoinEmailTemplates = [
  {
    name: "Bitcoin Payment Received",
    template_key: BITCOIN_PAYMENT_RECEIVED_TEMPLATE,
    description:
      "Bitcoin checkout: BTCPay has seen the payment and it is waiting for network confirmation. Sent once per invoice by the complete-paid-bitcoin-carts job; the order confirmation follows when it confirms.",
    from: "orders@jaalyantra.com",
    subject: "We've received your Bitcoin payment",
    html_content: shell(
      "We've received your Bitcoin payment",
      `    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{customer_first_name}},</p>
    <p ${P}>Your payment of <strong>{{amount}}</strong> in Bitcoin has reached us. Thank you.</p>
    <p ${P}>Bitcoin payments are final once the network confirms them, which usually takes 10 to 60 minutes. You don't need to do anything or keep any page open: your order is placed automatically once it confirms, and we will email you the order confirmation then.</p>
    {{#if status_url}}<div style="text-align:center;margin:28px 0;">
      <a href="{{status_url}}" style="background:#18181B;color:#FFFFFF;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500;display:inline-block;">Check the status</a>
    </div>{{/if}}
    <p style="color:#71717A;font-size:13px;margin:12px 0 0;">If you don't hear from us within a few hours, reply to this email and we'll look into it.</p>`
    ),
    variables: {
      customer_first_name: "Buyer's first name (or 'there')",
      amount: "What the buyer paid, in the cart currency, e.g. ₹1,625.00",
      status_url: "Link to the waiting page, which opens the order once it is placed (may be empty)",
      current_year: "Current year",
    },
    template_type: "general",
    is_active: true,
  },
]
