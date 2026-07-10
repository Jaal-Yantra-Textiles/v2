import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../../../helpers"
import { paymentSchema } from "../../../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import InvestorService from "../../../../../modules/investor/service"

type Body = z.infer<typeof paymentSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const data = paymentSchema.parse({
    ...req.body,
    stake_id: req.params.id,
    investor_id: investor.id,
  })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createPayments(data as any)
  res.json({ payment: created })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listPayments(
    { stake_id: req.params.id } as any
  )
  res.json({ payments: items, count: items.length })
}
