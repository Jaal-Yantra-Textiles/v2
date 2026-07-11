import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { requireInvestor } from "../../../helpers"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"

// POST /investors/deals/:id/participate — the investor commits an amount to an
// open funding round. Creates a Stake in `unpaid` status (a pending
// participation) that an admin approves → PayU capital call.
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)

  const { data } = await query.graph({
    entity: "funding_round",
    filters: { id: req.params.id },
    fields: [
      "id",
      "cap_table_id",
      "price_per_share",
      "status",
      "round_type",
      "instrument_type",
      "valuation_cap",
      "discount_rate",
      "safe_type",
      "cap_table.currency_code",
      "metadata",
    ],
  })
  const round = data?.[0] as any
  if (!round) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Deal not found")
  }
  if (round.status !== "open") {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "This deal is not open")
  }

  const amount = Number((req.body as any)?.amount ?? 0)
  if (!amount || amount <= 0) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "A positive amount is required")
  }

  // SAFE / convertible / CCPS round → issue a Convertible instrument, not a
  // Stake. A CCPS (iSAFE) additionally allots preference shares up front, so we
  // record `num_shares` + a default 1x liquidation preference; the cap/discount
  // conversion economics are shared with the SAFE path.
  const isCcps = round.instrument_type === "ccps"
  const isConvertible =
    isCcps ||
    round.instrument_type === "safe" ||
    round.instrument_type === "convertible_note" ||
    round.round_type === "safe" ||
    round.round_type === "ccps"
  if (isConvertible) {
    const instrument_type = isCcps
      ? "ccps"
      : round.instrument_type === "convertible_note"
      ? "convertible_note"
      : "safe"

    const pps = Number(round.price_per_share ?? 0)
    const ccpsExtras = isCcps
      ? {
          num_shares: pps > 0 ? Math.round(amount / pps) : null,
          liquidation_preference_multiple:
            Number(round.metadata?.liquidation_preference_multiple ?? 1),
          conversion_ratio: Number(round.metadata?.conversion_ratio ?? 1),
        }
      : {}

    const created = await service.createConvertibles({
      investor_id: investor.id,
      cap_table_id: round.cap_table_id,
      funding_round_id: round.id,
      instrument_type,
      principal_amount: amount,
      currency_code: round.cap_table?.currency_code ?? null,
      valuation_cap: round.valuation_cap ?? null,
      discount_rate: round.discount_rate ?? null,
      safe_type: round.safe_type ?? "post_money",
      investment_date: new Date(),
      status: "outstanding",
      ...ccpsExtras,
    } as any)

    return res.status(201).json({ convertible: created })
  }

  const pricePerShare = Number(round.price_per_share ?? 0)
  const shares = pricePerShare > 0 ? Math.round(amount / pricePerShare) : 0

  const created = await service.createStakes({
    investor_id: investor.id,
    cap_table_id: round.cap_table_id,
    funding_round_id: round.id,
    // Optional belongsTo relations must be an explicit null (MikroORM rejects
    // `undefined` for a relation FK with "value is required").
    share_class_id: null,
    number_of_shares: shares,
    share_price: pricePerShare || null,
    total_invested: amount,
    status: "unpaid",
  } as any)

  res.status(201).json({ stake: created })
}
