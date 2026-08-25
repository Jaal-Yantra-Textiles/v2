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
      Your quote for {{total_quantity}} piece(s) across {{line_count}} line(s) is ready to view. The link below shows your prices, the freight to {{destination}}, and the landed total.
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
    line_count: "Number of quoted LINES (rows on the quote), not pieces",
    total_quantity: "Total PIECES across every line — what a buyer means by \"items\"",
    // Passed in, never computed here — see the header.
    expires_on: "Human-readable expiry date, from the quote's expires_at",
    current_year: "Current year (e.g. 2026)",
  },
}


export const QUOTE_INTRODUCTION_TEMPLATE_KEY = "partner-quote-introduction"

/**
 * The partner introduction, sent just before the quote itself.
 *
 * 🔴 THIS TEMPLATE EXISTED ONLY IN THE PRODUCTION DATABASE. It was created
 * through the admin UI and lives in no seed, no migration and no commit — so it
 * could not be reviewed, tested, restored, or diffed, and the defect below sat
 * in a buyer-facing email with nothing in the repository that could have caught
 * it. It is checked in here for the same reason its sibling above is.
 *
 * 🔴 The defect: the copy read "Your quote for {{line_count}} item(s)", and
 * `line_count` is `lines.length` — ROWS, not pieces. A single line of 29
 * scarves introduced itself as "1 item(s)"; a six-line quote for ten pieces as
 * "6". The word "item(s)" is what makes it wrong: the number was accurate for a
 * question nobody asked and wrong for the one a buyer reads. Worse, the mint
 * event carried no quantity at all, so no edit to this template alone could
 * have fixed it — see `total_quantity` on the delivery workflow.
 *
 * 🔑 It is sent by a VISUAL FLOW listening on `partner_quote.minted`, not by
 * the mint. Anything this template renders must therefore exist on that event's
 * payload; a variable that is merely available inside the workflow is not
 * available here.
 */
export const QUOTE_INTRODUCTION_TEMPLATE_DEFINITION = {
  name: "B2B Partner Introduction",
  template_key: QUOTE_INTRODUCTION_TEMPLATE_KEY,
  from: "sales@jaalyantra.com",
  subject: "An introduction to {{partner_name}}",
  html_content: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#FAFAFA;">
<div style="max-width:640px;margin:0 auto;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:12px;overflow:hidden;margin-top:24px;margin-bottom:24px;">
  <div style="background:#27272A;padding:32px;text-align:center;">
    <h1 style="color:#FFFFFF;font-size:20px;font-weight:600;margin:0;">An introduction</h1>
    <p style="color:#A1A1AA;font-size:13px;margin:6px 0 0;">Before your quote from {{partner_name}}</p>
  </div>
  <div style="padding:32px;">
    <p style="color:#18181B;font-size:16px;font-weight:500;margin:0;">Hello,</p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">
      Your quote for {{total_quantity}} piece(s) across {{line_count}} line(s) is being prepared by <strong>{{partner_name}}</strong> and follows shortly in a separate email. Before it arrives, a word about who you are buying from.
    </p>
    <p style="color:#52525B;font-size:14px;line-height:1.6;margin:12px 0;">
      {{partner_name}} is a maker on Jaal Yantra Textiles. The goods are produced in their own workshop and dispatched directly from it &mdash; there is no intermediate warehouse and no relabelling. The quote names the maker alongside the pieces, the freight and one total.
    </p>
    <div style="background:#FAFAFA;border:1px solid #E4E4E7;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="color:#71717A;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">What to expect</p>
      <p style="color:#52525B;font-size:14px;line-height:1.6;margin:0;">
        One quote covering the whole basket, shipped as a single consignment. Freight is charged once across all of it, not per line. Your prices are held for the validity period stated on the quote.
      </p>
    </div>
    <p style="color:#71717A;font-size:13px;margin:12px 0 0;">
      If anything in the quote does not match what you asked for, reply to this email and it will reach the people who prepared it.
    </p>
  </div>
  <div style="background:#FAFAFA;padding:20px 32px;text-align:center;border-top:1px solid #E4E4E7;">
    <p style="color:#71717A;font-size:11px;margin:0;">Sent by {{partner_name}} via Jaal Yantra Textiles</p>
  </div>
</div></body></html>`,
  variables: {
    partner_name: "The partner the buyer is being introduced to — always present on partner_quote.minted",
    recipient_name: "Buyer contact name, or their company when no name was given",
    recipient_company: "The buyer's company, when they gave one",
    line_count: "Number of quoted LINES (rows on the quote), not pieces",
    total_quantity: "Total PIECES across every line — what a buyer means by \"items\"",
    destination: "Destination country the goods would ship to",
    current_year: "Current year (e.g. 2026)",
  },
}

export const quoteEmailTemplates = [
  QUOTE_TEMPLATE_DEFINITION,
  QUOTE_INTRODUCTION_TEMPLATE_DEFINITION,
]
