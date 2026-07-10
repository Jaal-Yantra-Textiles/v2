import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../../../helpers"
import { callForSharesSchema } from "../../../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import InvestorService from "../../../../../modules/investor/service"

type Body = z.infer<typeof callForSharesSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const data = callForSharesSchema.parse({
    ...req.body,
    cap_table_id: req.params.id,
  })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createCallForShares(data as any)
  res.json({ call_for_shares: created })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listCallForShares(
    { cap_table_id: req.params.id } as any
  )
  res.json({ calls_for_shares: items, count: items.length })
}
