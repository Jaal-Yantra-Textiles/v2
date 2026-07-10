import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { requireInvestor, refetchInvestor } from "../helpers"
import { investorUpdateSchema } from "../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../modules/investor"
import InvestorService from "../../../modules/investor/service"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

type UpdateBody = z.infer<typeof investorUpdateSchema>

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const fresh = await refetchInvestor(investor.id, req.scope)
  res.json({ investor: fresh })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<UpdateBody>,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const data = investorUpdateSchema.parse(req.body)

  const investorService: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  await investorService.updateInvestors({
    id: investor.id,
    ...data,
  } as any)

  const fresh = await refetchInvestor(investor.id, req.scope)
  res.json({ investor: fresh })
}
