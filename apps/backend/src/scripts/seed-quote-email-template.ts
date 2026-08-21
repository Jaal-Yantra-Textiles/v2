export const QUOTE_TEMPLATE_KEY = "partner-quote-issued"

/**
 * The quote email (#1420).
 *
 * 🔴 This email is the ONLY durable copy of the buyer link. The raw token is
 * returned once by the mint and never stored — only its sha256 is — so if the
 * send fails, the quote exists and is unreachable. That is why the sender must
 * treat a delivery failure as loud and re-mintable rather than as a warning.
 *
 * 🔑 `expires_on` is passed IN rather than computed here. Expiry is enforced by
 * the price list's own `ends_at`, and an email that calculates its own date is
 * free to disagree with the thing that actually stops the prices working.
 */
export const QUOTE_TEMPLATE_DEFINITION = {
  name: "B2B Quote Issued",
  template_key: QUOTE_TEMPLATE_KEY,
  from: "sales@jaalyantra.com",
  subject: "Your quote from {{partner_name}}",
  html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">Your quote is ready</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Prepared by {{partner_name}}</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hi {{recipient_name}},</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">
      Your quote for {{line_count}} item(s) is ready to view. The link below shows your prices, the freight to {{destination}}, and the landed total.
    </p>
    <div style="background:#FAFAFA;border:1px solid #E4E4E7;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#71717A;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.05em;">Landed total</p>
      <p style="color:#18181B;font-size:24px;font-weight:600;margin:0;">{{landed_total}}</p>
      <p style="color:#71717A;font-size:12px;margin:8px 0 0;">Includes freight to {{destination}}.</p>
    </div>
    <div style="text-align:center;margin:24px 0;">
      <a href="{{quote_url}}" style="display:inline-block;background:#27272A;color:#FFFFFF;text-decoration:none;padding:10px 24px;border-radius:8px;font-weight:500;font-size:14px;">View your quote</a>
    </div>
    <p style="color:#71717A;font-size:13px;margin:12px 0 0;">
      This quote is valid until <strong>{{expires_on}}</strong>. It is an estimate, not a binding offer — prices, freight and availability are confirmed when the order is placed.
    </p>
    <p style="color:#A1A1AA;font-size:12px;margin:16px 0 0;">
      The link is personal to your organisation. Anyone you forward it to can see these prices.
    </p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">&copy; {{current_year}} {{partner_name}}</p>
  </div>
</div></body></html>`,
  variables: {
    recipient_name: "Buyer contact name, or their company when no name was given",
    partner_name: "The partner who issued the quote",
    quote_url: "The buyer link — https://<domain>/<countryCode>/quotes/<token>",
    landed_total: "Formatted landed total, e.g. Rs 36,00,000",
    destination: "Destination city/country the freight was quoted to",
    line_count: "Number of quoted lines",
    // Passed in, never computed here — see the header.
    expires_on: "Human-readable expiry date, from the quote's expires_at",
    current_year: "Current year (e.g. 2026)",
  },
}

export const quoteEmailTemplates = [QUOTE_TEMPLATE_DEFINITION]
