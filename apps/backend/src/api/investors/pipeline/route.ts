import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../helpers"
import { pipelineSchema } from "../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../modules/investor"
import InvestorService from "../../../modules/investor/service"

type Body = z.infer<typeof pipelineSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const data = pipelineSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createPipelines({
    ...data,
    investor_id: investor.id,
  } as any)
  res.json({ pipeline: created })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listPipelines(
    { investor_id: investor.id } as any
  )
  res.json({ pipeline: items, count: items.length })
}
