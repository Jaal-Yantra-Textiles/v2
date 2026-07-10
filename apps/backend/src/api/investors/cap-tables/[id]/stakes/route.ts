import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../../../helpers"
import { stakeSchema } from "../../../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import InvestorService from "../../../../../modules/investor/service"

type Body = z.infer<typeof stakeSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const data = stakeSchema.parse({
    ...req.body,
    cap_table_id: req.params.id,
    investor_id: req.body.investor_id || investor.id,
  })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createStakes(data as any)
  res.json({ stake: created })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listStakes(
    { cap_table_id: req.params.id } as any
  )
  res.json({ stakes: items, count: items.length })
}
