/**
 * Seed: Investor subscription-agreement templates (#969).
 *
 * When an investor commits to an open funding round
 * (`POST /investors/deals/:id/participate`) we generate a subscription /
 * SAFE / CCPS agreement from a reusable template, render it with the
 * participation's variables (Handlebars), persist it as an
 * `investor_document` (subscription_agreement) and email the investor a
 * "Review & sign" link. This script seeds:
 *
 *   1. Three `agreement` rows (the legal body templates), one per instrument
 *      group — matched at participate time by `metadata.investor_instrument`:
 *        - equity  → "Equity Subscription Agreement"
 *        - safe    → "SAFE Subscription Agreement"     (SAFE / convertible note)
 *        - ccps    → "CCPS Subscription Agreement"     (iSAFE / preference)
 *      A funding round may override the choice via `metadata.agreement_id`.
 *
 *   2. One `email_template` row `investor-agreement` — the email wrapper that
 *      carries the "Review & sign" CTA to the portal.
 *
 * Idempotent — skips any row whose key/title already exists. Safe to re-run.
 * Run via data plumbing:
 *
 *   npx medusa exec ./src/scripts/seed-investor-agreement-templates.ts
 *   # prod: ./deploy/aws/scripts/run-backfill.sh seed-investor-agreement-templates
 *
 * Variables the generate-investor-agreement workflow passes to the agreement
 * `content` (all Handlebars `{{var}}`):
 *   investor_name, investor_email, investor_legal_name, company_name,
 *   deal_name, instrument_label, amount, amount_formatted, currency,
 *   number_of_shares, share_price, share_price_formatted, principal,
 *   principal_formatted, valuation_cap, valuation_cap_formatted,
 *   discount_rate, safe_type, signed_date, current_year, agreement_url.
 */
import { EMAIL_TEMPLATES_MODULE } from "../modules/email_templates"
import { AGREEMENTS_MODULE } from "../modules/agreements"

const FROM = "investors@jaalyantra.com"

// --- shared agreement chrome ------------------------------------------------
const wrap = (body: string) =>
  `<div style="font-family:Georgia,'Times New Roman',serif;max-width:640px;margin:0 auto;color:#1c1c22;line-height:1.7;font-size:15px">${body}<hr style="border:none;border-top:1px solid #e4e4e7;margin:28px 0"/><p style="font-size:12px;color:#a1a1aa;font-family:-apple-system,Segoe UI,Roboto,sans-serif">This agreement was generated for {{investor_name}} ({{investor_email}}) on {{signed_date}}. By selecting "I agree" you confirm you have read and accept the terms above.<br/>Jaal Yantra Textiles · {{current_year}}</p></div>`

const partiesBlock = `
<p style="margin:0 0 14px"><strong>Subscription details</strong></p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <tr><td style="padding:7px 12px;border:1px solid #e4e4e7;color:#71717a;background:#f8f8f9;width:45%">Investor</td><td style="padding:7px 12px;border:1px solid #e4e4e7">{{investor_legal_name}}</td></tr>
  <tr><td style="padding:7px 12px;border:1px solid #e4e4e7;color:#71717a;background:#f8f8f9">Company</td><td style="padding:7px 12px;border:1px solid #e4e4e7">{{company_name}}</td></tr>
  <tr><td style="padding:7px 12px;border:1px solid #e4e4e7;color:#71717a;background:#f8f8f9">Round</td><td style="padding:7px 12px;border:1px solid #e4e4e7">{{deal_name}} · {{instrument_label}}</td></tr>
  <tr><td style="padding:7px 12px;border:1px solid #e4e4e7;color:#71717a;background:#f8f8f9">Amount</td><td style="padding:7px 12px;border:1px solid #e4e4e7"><strong>{{amount_formatted}}</strong></td></tr>
</table>`

export const investorAgreements = [
  {
    investor_instrument: "equity",
    title: "Equity Subscription Agreement",
    subject: "Equity Subscription Agreement — {{company_name}}",
    content: wrap(`
<h1 style="font-size:20px;margin:0 0 8px">Equity Subscription Agreement</h1>
<p style="color:#52525b;margin:0 0 20px;font-size:13px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">{{company_name}} · {{deal_name}}</p>
${partiesBlock}
<p>This Subscription Agreement is entered into as of {{signed_date}} between <strong>{{investor_legal_name}}</strong> (the "Investor") and <strong>{{company_name}}</strong> (the "Company").</p>
<p><strong>1. Subscription.</strong> The Investor hereby subscribes for <strong>{{number_of_shares}}</strong> shares at a price of <strong>{{share_price_formatted}}</strong> per share, for a total subscription amount of <strong>{{amount_formatted}}</strong>.</p>
<p><strong>2. Payment.</strong> The Investor shall pay the subscription amount in {{currency}} in accordance with the capital-call instructions issued by the Company following approval of this subscription.</p>
<p><strong>3. Representations.</strong> The Investor represents that they are acquiring the shares for their own account, for investment purposes, and that they have had the opportunity to review the Company's cap table and financial position.</p>
<p><strong>4. Governing terms.</strong> The shares are subject to the Company's constitutional documents and any shareholders' agreement then in effect. This agreement is governed by the laws applicable to the Company's jurisdiction of incorporation.</p>`),
  },
  {
    investor_instrument: "safe",
    title: "SAFE Subscription Agreement",
    subject: "SAFE Agreement — {{company_name}}",
    content: wrap(`
<h1 style="font-size:20px;margin:0 0 8px">Simple Agreement for Future Equity (SAFE)</h1>
<p style="color:#52525b;margin:0 0 20px;font-size:13px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">{{company_name}} · {{deal_name}}</p>
${partiesBlock}
<p>This instrument is a Simple Agreement for Future Equity ("SAFE") issued on {{signed_date}} by <strong>{{company_name}}</strong> (the "Company") to <strong>{{investor_legal_name}}</strong> (the "Investor").</p>
<p><strong>1. Investment.</strong> In exchange for the payment of <strong>{{principal_formatted}}</strong> (the "Purchase Amount"), the Investor is entitled to convert this SAFE into equity on the terms below.</p>
<p><strong>2. Conversion terms.</strong> Valuation cap: <strong>{{valuation_cap_formatted}}</strong>. Discount rate: <strong>{{discount_rate}}%</strong>. SAFE type: <strong>{{safe_type}}</strong>. On a subsequent priced equity financing, the Purchase Amount converts into shares at the lower of the cap price and the discounted round price.</p>
<p><strong>3. No shares issued now.</strong> This SAFE is not a debt instrument and does not, of itself, entitle the Investor to any rights of a shareholder until conversion.</p>
<p><strong>4. Governing terms.</strong> This SAFE is governed by the laws applicable to the Company's jurisdiction of incorporation and is subject to the Company's constitutional documents.</p>`),
  },
  {
    investor_instrument: "ccps",
    title: "CCPS Subscription Agreement",
    subject: "CCPS Subscription Agreement — {{company_name}}",
    content: wrap(`
<h1 style="font-size:20px;margin:0 0 8px">Compulsorily Convertible Preference Shares (CCPS)</h1>
<p style="color:#52525b;margin:0 0 20px;font-size:13px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">{{company_name}} · {{deal_name}}</p>
${partiesBlock}
<p>This Subscription Agreement for Compulsorily Convertible Preference Shares ("CCPS", an iSAFE-equivalent preference instrument) is entered into as of {{signed_date}} between <strong>{{investor_legal_name}}</strong> (the "Investor") and <strong>{{company_name}}</strong> (the "Company").</p>
<p><strong>1. Subscription.</strong> The Investor subscribes for <strong>{{number_of_shares}}</strong> CCPS for a total consideration of <strong>{{amount_formatted}}</strong>.</p>
<p><strong>2. Conversion.</strong> The CCPS compulsorily convert into equity shares on the terms of the round — valuation cap <strong>{{valuation_cap_formatted}}</strong>, discount <strong>{{discount_rate}}%</strong> — on the earlier of a qualified financing, an exit, or the long-stop conversion date.</p>
<p><strong>3. Preference.</strong> The CCPS carry a liquidation preference and any agreed dividend entitlement as set out in the Company's constitutional documents, ranking ahead of equity shares on a liquidation event.</p>
<p><strong>4. Governing terms.</strong> This agreement is governed by the laws of India and the Company's constitutional documents.</p>`),
  },
]

export const investorAgreementEmailTemplate = {
  template_key: "investor-agreement",
  name: "Investor — Subscription Agreement to sign",
  template_type: "investor",
  from: FROM,
  is_active: true,
  subject: "Please review & sign your {{instrument_label}} — {{company_name}}",
  variables: {
    investor_name: "Investor display name",
    company_name: "Company name",
    deal_name: "Funding round name",
    instrument_label: "Instrument label (Equity Subscription / SAFE / CCPS)",
    amount_formatted: "Formatted investment amount",
    agreement_url: "Portal link to review & sign the agreement",
    current_year: "Year",
  },
  html_content: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b"><h1 style="font-size:18px;margin:0 0 12px">Hi {{investor_name}},</h1><p style="font-size:14px;line-height:1.6;color:#3f3f46">Thank you for committing <strong>{{amount_formatted}}</strong> to <strong>{{deal_name}}</strong> at <strong>{{company_name}}</strong>. Your <strong>{{instrument_label}}</strong> is ready for review.</p><p style="font-size:14px;line-height:1.6;color:#3f3f46">Please review the agreement and sign it to formalise your participation.</p><p style="margin:22px 0"><a href="{{agreement_url}}" style="background:#18181b;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;display:inline-block">Review &amp; sign your agreement</a></p><p style="font-size:13px;line-height:1.6;color:#71717a">If the button doesn't work, copy this link into your browser:<br/><span style="color:#3f3f46">{{agreement_url}}</span></p><p style="font-size:12px;color:#a1a1aa;margin-top:24px">Jaal Yantra Textiles · {{current_year}}</p></div>`,
}

export default async function seedInvestorAgreementTemplates({
  container,
}: {
  container: any
}) {
  const logger = container.resolve("logger")
  const emailSvc: any = container.resolve(EMAIL_TEMPLATES_MODULE)
  const agreementsSvc: any = container.resolve(AGREEMENTS_MODULE)

  // 1. email wrapper
  let emailExists = false
  try {
    await emailSvc.getTemplateByKey(investorAgreementEmailTemplate.template_key)
    emailExists = true
  } catch {
    emailExists = false
  }
  if (emailExists) {
    logger.info(
      `[seed-investor-agreement-templates] ⏭ email ${investorAgreementEmailTemplate.template_key} exists — skip`
    )
  } else {
    await emailSvc.createEmailTemplates([investorAgreementEmailTemplate])
    logger.info(
      `[seed-investor-agreement-templates] ✅ created email ${investorAgreementEmailTemplate.template_key}`
    )
  }

  // 2. agreement bodies
  let created = 0
  let skipped = 0
  for (const a of investorAgreements) {
    const existing = await agreementsSvc.listAgreements({ title: a.title })
    if (existing && existing.length) {
      skipped++
      logger.info(
        `[seed-investor-agreement-templates] ⏭ agreement "${a.title}" exists — skip`
      )
      continue
    }
    await agreementsSvc.createAgreements({
      title: a.title,
      subject: a.subject,
      content: a.content,
      template_key: investorAgreementEmailTemplate.template_key,
      status: "active",
      from_email: FROM,
      metadata: { investor_instrument: a.investor_instrument, scope: "investor" },
    })
    created++
    logger.info(
      `[seed-investor-agreement-templates] ✅ created agreement "${a.title}" (${a.investor_instrument})`
    )
  }
  logger.info(
    `[seed-investor-agreement-templates] done — agreements created=${created} skipped=${skipped}`
  )
}
