import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../modules/investor"
import type InvestorService from "../../../modules/investor/service"
import { companyExpenseSchema } from "../../investors/validators"

// GET /admin/company-expenses — list company operating expenses (optionally
// filtered by ?company_id / ?category / ?status).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const { company_id, category, status } = req.query as Record<string, string>
  const filters: Record<string, any> = {}
  if (company_id) filters.company_id = company_id
  if (category) filters.category = category
  if (status) filters.status = status

  const [items, count] = await service.listAndCountCompanyExpenses(filters, {
    take: 500,
    order: { created_at: "DESC" },
  } as any)
  res.json({ company_expenses: items, count })
}

// POST /admin/company-expenses — record an expense (partnership cost, tech stack, …).
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = companyExpenseSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createCompanyExpenses(data as any)
  res.status(201).json({ company_expense: created })
}
