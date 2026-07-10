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
    fields: ["id", "cap_table_id", "price_per_share", "status"],
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
