import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { COMPANY_MODULE } from "../../../modules/company"
import type CompanyService from "../../../modules/company/service"

// GET /admin/companies — list companies (platform admin)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const offset = Number((req.query as any)?.offset ?? 0)
  const limit = Number((req.query as any)?.limit ?? 20)

  const service: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const [companies, count] = await service.listAndCountCompanies(
    {},
    { skip: offset, take: limit, order: { created_at: "DESC" } }
  )

  res.json({ companies, count, offset, limit })
}

// POST /admin/companies — create a company (validated against companySchema)
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const created = await service.createCompanies(req.validatedBody as any)
  res.status(201).json({ company: created })
}
