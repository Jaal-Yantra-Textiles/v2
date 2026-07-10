import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../../../helpers"
import { fundingRoundSchema } from "../../../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import InvestorService from "../../../../../modules/investor/service"

type Body = z.infer<typeof fundingRoundSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const data = fundingRoundSchema.parse({
    ...req.body,
    cap_table_id: req.params.id,
  })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createFundingRounds(data as any)
  res.json({ funding_round: created })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listFundingRounds(
    { cap_table_id: req.params.id } as any
  )
  res.json({ funding_rounds: items, count: items.length })
}
