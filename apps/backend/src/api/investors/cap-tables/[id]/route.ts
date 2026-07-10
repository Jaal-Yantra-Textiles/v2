import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor, refetchCapTable } from "../../helpers"
import { capTableUpdateSchema } from "../../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../../modules/investor"
import InvestorService from "../../../../modules/investor/service"

type Body = z.infer<typeof capTableUpdateSchema>

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const fresh = await refetchCapTable(req.params.id, req.scope)
  res.json({ cap_table: fresh })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const data = capTableUpdateSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  await service.updateCapTables({ id: req.params.id, ...data } as any)
  const fresh = await refetchCapTable(req.params.id, req.scope)
  res.json({ cap_table: fresh })
}
