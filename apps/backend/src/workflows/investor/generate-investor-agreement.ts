import {
  createWorkflow,
  WorkflowResponse,
  createStep,
  StepResponse,
  transform,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomBytes } from "crypto"
import * as Handlebars from "handlebars"
import { sendNotificationEmailWorkflow } from "../email/send-notification-email"
import { INVESTOR_MODULE } from "../../modules/investor"
import { AGREEMENTS_MODULE } from "../../modules/agreements"
import { AGREEMENT_RESPONSE_MODULE } from "../../modules/agreement-responses"

// One of the three instrument groups the participate route can produce. `equity`
// → Stake; `safe` covers SAFE + plain convertible note; `ccps` → iSAFE.
export type InvestorInstrumentGroup = "equity" | "safe" | "ccps"

export type GenerateInvestorAgreementInput = {
  investor_id: string
  funding_round_id: string
  cap_table_id: string
  instrument_group: InvestorInstrumentGroup
  /** Human label surfaced in the email/agreement (e.g. "SAFE"). */
  instrument_label: string
  amount: number
  currency_code?: string | null
  // Equity figures (present for `equity` / `ccps`).
  number_of_shares?: number | null
  share_price?: number | null
  // Convertible figures (present for `safe` / `ccps`).
  principal?: number | null
  valuation_cap?: number | null
  discount_rate?: number | null
  safe_type?: string | null
  // Reference to the created instrument (for traceability on the response/doc).
  stake_id?: string | null
  convertible_id?: string | null
}

const PORTAL_URL =
  process.env.INVESTOR_PORTAL_URL || "https://invest.jaalyantra.com"

const fmtMoney = (currency: string | null | undefined, amount: number | null | undefined) => {
  if (amount == null) return ""
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: (currency || "INR").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(Number(amount))
  } catch {
    return `${(currency || "").toUpperCase()} ${Number(amount).toLocaleString()}`
  }
}

// Register Handlebars helpers once (mirrors fetch-email-template.ts) so agreement
// bodies may use {{formatMoney currency amount}} in addition to the precomputed
// *_formatted vars.
Handlebars.registerHelper("formatMoney", (currency: string, amount: number) =>
  fmtMoney(currency, amount)
)

/**
 * Resolve the agreement template, render it with the participation's variables,
 * persist an agreement_response (with a secure access token), and persist an
 * investor_document (subscription_agreement, investor-visible). Returns the
 * data the email step needs. Rendering, response + document creation all happen
 * here to keep the workflow graph shallow (the workflow SDK's transform typing
 * otherwise blows the TS stack depth).
 */
const prepareInvestorAgreementStep = createStep(
  "prepare-investor-agreement",
  async (input: GenerateInvestorAgreementInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const investorSvc: any = container.resolve(INVESTOR_MODULE)
    const agreementsSvc: any = container.resolve(AGREEMENTS_MODULE)
    const responseSvc: any = container.resolve(AGREEMENT_RESPONSE_MODULE)

    // --- resolve investor ---------------------------------------------------
    const investor = await investorSvc.retrieveInvestor(input.investor_id)

    // --- resolve company / deal names --------------------------------------
    const { data: capTables } = await query.graph({
      entity: "cap_tables",
      filters: { id: input.cap_table_id },
      fields: ["id", "name", "company_id", "currency_code"],
    })
    const capTable = capTables?.[0] as any
    let companyName = capTable?.name || "the Company"
    if (capTable?.company_id) {
      try {
        const { data: companies } = await query.graph({
          entity: "companies",
          filters: { id: capTable.company_id },
          fields: ["id", "name"],
        })
        if (companies?.[0]?.name) companyName = companies[0].name
      } catch {
        // companies module/entity not addressable — fall back to cap-table name
      }
    }

    const { data: rounds } = await query.graph({
      entity: "funding_round",
      filters: { id: input.funding_round_id },
      fields: ["id", "name", "metadata"],
    })
    const round = rounds?.[0] as any
    const dealName = round?.name || "Funding round"

    // --- resolve agreement template ----------------------------------------
    // Per-round override wins; else match by metadata.investor_instrument.
    let agreement: any = null
    const overrideId = round?.metadata?.agreement_id
    if (overrideId) {
      const found = await agreementsSvc.listAgreements({ id: overrideId })
      agreement = found?.[0] || null
    }
    if (!agreement) {
      const all = await agreementsSvc.listAgreements({ status: "active" })
      agreement =
        (all || []).find(
          (a: any) => a?.metadata?.investor_instrument === input.instrument_group
        ) || null
    }
    if (!agreement) {
      throw new Error(
        `No active investor agreement template for instrument group "${input.instrument_group}". Run seed-investor-agreement-templates.`
      )
    }

    // --- build template variables ------------------------------------------
    const currency = input.currency_code || capTable?.currency_code || "INR"
    const now = new Date()
    const signedDate = now.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    })
    const vars: Record<string, any> = {
      investor_name: investor?.name || "",
      investor_email: investor?.email || "",
      investor_legal_name: investor?.legal_name || investor?.name || "",
      company_name: companyName,
      deal_name: dealName,
      instrument_label: input.instrument_label,
      amount: input.amount,
      amount_formatted: fmtMoney(currency, input.amount),
      currency: currency.toUpperCase(),
      number_of_shares: input.number_of_shares ?? "",
      share_price: input.share_price ?? "",
      share_price_formatted: fmtMoney(currency, input.share_price),
      principal: input.principal ?? input.amount,
      principal_formatted: fmtMoney(currency, input.principal ?? input.amount),
      valuation_cap: input.valuation_cap ?? "",
      valuation_cap_formatted: input.valuation_cap
        ? fmtMoney(currency, input.valuation_cap)
        : "—",
      discount_rate: input.discount_rate ?? 0,
      safe_type: input.safe_type || "post_money",
      signed_date: signedDate,
      current_year: String(now.getFullYear()),
    }

    // --- render body + subject ---------------------------------------------
    let renderedHtml = agreement.content
    let renderedSubject = agreement.subject
    try {
      renderedHtml = Handlebars.compile(agreement.content)(vars)
      renderedSubject = Handlebars.compile(agreement.subject || "")(vars)
    } catch (e) {
      // Fall back to the raw template rather than fail the participation.
    }

    // --- create the signable response --------------------------------------
    const accessToken = randomBytes(32).toString("hex")
    const response = await responseSvc.createAgreementResponses({
      agreement_id: agreement.id,
      email_sent_to: investor?.email,
      sent_at: now,
      status: "sent",
      access_token: accessToken,
      metadata: {
        investor_id: input.investor_id,
        funding_round_id: input.funding_round_id,
        cap_table_id: input.cap_table_id,
        stake_id: input.stake_id || null,
        convertible_id: input.convertible_id || null,
        instrument_group: input.instrument_group,
        instrument_label: input.instrument_label,
        company_name: companyName,
        deal_name: dealName,
        amount: input.amount,
        amount_formatted: vars.amount_formatted,
        currency: vars.currency,
        rendered_html: renderedHtml,
        rendered_subject: renderedSubject,
      },
    })

    const agreementUrl = `${PORTAL_URL}/agreements/${response.id}`

    // --- persist the durable document artifact -----------------------------
    let documentId: string | null = null
    try {
      const doc = await investorSvc.createDocuments({
        cap_table_id: input.cap_table_id,
        company_id: capTable?.company_id || "",
        investor_id: input.investor_id,
        title: `${input.instrument_label} — ${dealName}`,
        description: `Subscription agreement for ${investor?.name || "investor"} (${vars.amount_formatted})`,
        document_type: "subscription_agreement",
        file_key: `investor-agreement/${response.id}`,
        file_url: agreementUrl,
        file_name: `${input.instrument_label}.html`,
        mime_type: "text/html",
        visibility: "investor",
        uploaded_by: "system",
        metadata: {
          agreement_id: agreement.id,
          agreement_response_id: response.id,
          instrument_group: input.instrument_group,
          rendered_html: renderedHtml,
        },
      })
      documentId = doc?.id || null
    } catch (e) {
      // A cap-table without a company_id shouldn't block the email; log-only.
    }

    // Bump the agreement's sent counter (best-effort).
    try {
      await agreementsSvc.updateAgreements({
        selector: { id: agreement.id },
        data: { sent_count: (agreement.sent_count || 0) + 1 },
      })
    } catch {
      /* non-fatal */
    }

    return new StepResponse(
      {
        response_id: response.id,
        access_token: accessToken,
        agreement_id: agreement.id,
        document_id: documentId,
        email_to: investor?.email as string,
        agreement_url: agreementUrl,
        email_data: {
          investor_name: vars.investor_name,
          company_name: companyName,
          deal_name: dealName,
          instrument_label: input.instrument_label,
          amount_formatted: vars.amount_formatted,
          agreement_url: agreementUrl,
          current_year: vars.current_year,
        },
      },
      // compensation payload
      { response_id: response.id, document_id: documentId }
    )
  },
  async (payload: any, { container }) => {
    if (!payload) return
    try {
      const responseSvc: any = container.resolve(AGREEMENT_RESPONSE_MODULE)
      if (payload.response_id)
        await responseSvc.softDeleteAgreementResponses(payload.response_id)
    } catch {
      /* ignore */
    }
    try {
      const investorSvc: any = container.resolve(INVESTOR_MODULE)
      if (payload.document_id)
        await investorSvc.softDeleteDocuments(payload.document_id)
    } catch {
      /* ignore */
    }
  }
)

export const generateInvestorAgreementWorkflow = createWorkflow(
  "generate-investor-agreement",
  (input: GenerateInvestorAgreementInput) => {
    const prepared = prepareInvestorAgreementStep(input)

    sendNotificationEmailWorkflow.runAsStep({
      // @ts-ignore - deep workflow generics blow the TS stack depth
      input: transform({ prepared }, (data: any) => ({
        to: data.prepared.email_to,
        template: "investor-agreement",
        data: data.prepared.email_data,
      })),
    })

    return new WorkflowResponse(prepared)
  }
)
