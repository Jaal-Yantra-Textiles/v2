import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../../../helpers"
import { documentSchema } from "../../../validators"
import type { z } from "@medusajs/framework/zod"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import InvestorService from "../../../../../modules/investor/service"

type Body = z.infer<typeof documentSchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const data = documentSchema.parse({
    ...req.body,
    cap_table_id: req.params.id,
  })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createDocuments({
    ...data,
    uploaded_by: investor.id,
  } as any)
  res.json({ document: created })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const items = await service.listDocuments(
    { cap_table_id: req.params.id } as any
  )
  res.json({ documents: items, count: items.length })
}
