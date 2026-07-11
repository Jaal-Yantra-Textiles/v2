import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { INVESTOR_MODULE } from "../../../../modules/investor"
import type InvestorService from "../../../../modules/investor/service"
import { companyExpenseUpdateSchema } from "../../../investors/validators"

// POST /admin/company-expenses/:id — update an expense.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = companyExpenseUpdateSchema.parse(req.body)
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const updated = await service.updateCompanyExpenses({ id: req.params.id, ...data } as any)
  res.json({ company_expense: updated })
}

// DELETE /admin/company-expenses/:id
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  await service.deleteCompanyExpenses(req.params.id)
  res.json({ id: req.params.id, object: "company_expense", deleted: true })
}
