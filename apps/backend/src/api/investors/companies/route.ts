import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { requireInvestor } from "../helpers"
import { companySchema } from "../validators"
import type { z } from "@medusajs/framework/zod"
import { COMPANY_MODULE } from "../../../modules/company"
import CompanyService from "../../../modules/company/service"

type Body = z.infer<typeof companySchema>

export const POST = async (
  req: AuthenticatedMedusaRequest<Body>,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const data = companySchema.parse(req.body)
  const service: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const created = await service.createCompanies(data as any)
  res.json({ company: created })
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await requireInvestor(req.auth_context, req.scope)
  const service: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const items = await service.listCompanies()
  res.json({ companies: items, count: items.length })
}
