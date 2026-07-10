import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { COMPANY_MODULE } from "../../../../modules/company"
import type CompanyService from "../../../../modules/company/service"

// GET /admin/companies/:id — company detail
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: CompanyService = req.scope.resolve(COMPANY_MODULE)
  const [company] = await service.listCompanies({ id: req.params.id } as any)

  if (!company) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Company not found")
  }

  res.json({ company })
}
