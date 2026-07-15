import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  generateInvestorAgreementWorkflow,
  type GenerateInvestorAgreementInput,
} from "../../../workflows/investor/generate-investor-agreement"
import { AGREEMENT_RESPONSE_MODULE } from "../../../modules/agreement-responses"

export type IssueAgreementResult = {
  response_id: string | null
  agreement_url: string | null
  reused: boolean
}

// Has an agreement already been issued for this instrument? The generate
// workflow stamps `metadata.stake_id` / `metadata.convertible_id` on the
// agreement_response, so we match on that (scoped to the investor's email to
// keep the scan small). Prevents an admin double-issuing (and double-emailing).
async function findExistingResponse(
  scope: any,
  opts: { email?: string | null; stakeId?: string; convertibleId?: string }
): Promise<any | null> {
  if (!opts.email) return null
  const responseSvc: any = scope.resolve(AGREEMENT_RESPONSE_MODULE)
  const responses: any[] = await responseSvc.listAgreementResponses({
    email_sent_to: opts.email,
  })
  return (
    responses?.find(
      (r) =>
        (opts.stakeId && r.metadata?.stake_id === opts.stakeId) ||
        (opts.convertibleId && r.metadata?.convertible_id === opts.convertibleId)
    ) ?? null
  )
}

async function run(
  scope: any,
  input: GenerateInvestorAgreementInput
): Promise<IssueAgreementResult> {
  const { result } = await generateInvestorAgreementWorkflow(scope).run({ input })
  return {
    response_id: (result as any)?.response_id ?? null,
    agreement_url: (result as any)?.agreement_url ?? null,
    reused: false,
  }
}

// Issue (or return the already-issued) subscription agreement for an existing
// equity Stake. Reconstructs the workflow input from the persisted stake + its
// round + cap table + investor — the admin counterpart to the participate-time
// issuance, used to backfill participations created before the agreement
// templates existed (or that skipped issuance).
export async function issueAgreementForStake(
  scope: any,
  stakeId: string
): Promise<IssueAgreementResult> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "stake",
    filters: { id: stakeId },
    fields: [
      "id",
      "investor_id",
      "number_of_shares",
      "share_price",
      "total_invested",
      "funding_round_id",
      "cap_table_id",
      "investor.email",
      "funding_round.name",
      "cap_table.currency_code",
    ],
  })
  const stake = data?.[0]
  if (!stake) throw new Error(`Stake ${stakeId} not found`)

  const existing = await findExistingResponse(scope, {
    email: stake.investor?.email,
    stakeId,
  })
  if (existing) {
    return {
      response_id: existing.id,
      agreement_url: existing.metadata?.agreement_url ?? null,
      reused: true,
    }
  }

  return run(scope, {
    investor_id: stake.investor_id,
    funding_round_id: stake.funding_round_id ?? "",
    cap_table_id: stake.cap_table_id,
    instrument_group: "equity",
    instrument_label: "Equity Subscription Agreement",
    amount: Number(stake.total_invested ?? 0),
    currency_code: stake.cap_table?.currency_code ?? null,
    number_of_shares: stake.number_of_shares ?? null,
    share_price: stake.share_price ?? null,
    stake_id: stakeId,
  })
}

// Issue (or return the already-issued) subscription agreement for an existing
// convertible (SAFE / note / CCPS).
export async function issueAgreementForConvertible(
  scope: any,
  convertibleId: string
): Promise<IssueAgreementResult> {
  const query = scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "convertible",
    filters: { id: convertibleId },
    fields: [
      "id",
      "investor_id",
      "instrument_type",
      "principal_amount",
      "valuation_cap",
      "discount_rate",
      "safe_type",
      "num_shares",
      "funding_round_id",
      "cap_table_id",
      "investor.email",
      "cap_table.currency_code",
    ],
  })
  const c = data?.[0]
  if (!c) throw new Error(`Convertible ${convertibleId} not found`)

  const existing = await findExistingResponse(scope, {
    email: c.investor?.email,
    convertibleId,
  })
  if (existing) {
    return {
      response_id: existing.id,
      agreement_url: existing.metadata?.agreement_url ?? null,
      reused: true,
    }
  }

  const isCcps = c.instrument_type === "ccps"
  const label = isCcps
    ? "CCPS Subscription Agreement"
    : c.instrument_type === "convertible_note"
    ? "Convertible Note Agreement"
    : "SAFE Agreement"

  return run(scope, {
    investor_id: c.investor_id,
    funding_round_id: c.funding_round_id ?? "",
    cap_table_id: c.cap_table_id,
    instrument_group: isCcps ? "ccps" : "safe",
    instrument_label: label,
    amount: Number(c.principal_amount ?? 0),
    currency_code: c.cap_table?.currency_code ?? null,
    number_of_shares: isCcps ? c.num_shares ?? null : null,
    principal: Number(c.principal_amount ?? 0),
    valuation_cap: c.valuation_cap ?? null,
    discount_rate: c.discount_rate ?? null,
    safe_type: c.safe_type ?? "post_money",
    convertible_id: convertibleId,
  })
}
