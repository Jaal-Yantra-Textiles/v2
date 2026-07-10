import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../../helpers"
import { companyUpdateSchema } from "../../validators"
import type { z } from "@medusajs/framework/zod"
import { COMPANY_MODULE } from "../../../../modules/company"
import CompanyService from "../../../../modules/company/service"

type Body = z.infer<typeof companyUpdateSchema>

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const service: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const items = await service.listCompanies({ id: req.params.id } as any)
  res.json({ company: items[0] })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const data = companyUpdateSchema.parse(req.body)
  const service: CompanyService = req.scope.resolve(COMPANY_MODULE)
  await service.updateCompanies({ id: req.params.id, ...data } as any)
  const items = await service.listCompanies({ id: req.params.id } as any)
  res.json({ company: items[0] })
}
