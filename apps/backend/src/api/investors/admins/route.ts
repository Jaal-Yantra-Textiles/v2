import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../helpers"
import { investorAdminSchema } from "../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../modules/investor"
import InvestorService from "../../../modules/investor/service"

type Body = z.infer<typeof investorAdminSchema>

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listInvestorAdmins(
    { investor_id: investor.id } as any
  )
  res.json({ admins: items, count: items.length })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const data = investorAdminSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createInvestorAdmins({
    ...data,
    investor_id: investor.id,
  } as any)
  res.json({ admin: created })
}
