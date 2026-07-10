import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { paymentSchema } from "../../../../investors/validators"

// GET /admin/companies/:id/payments — the company's payments ledger (Financials)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const { data } = await query.graph({
    entity: "investor_payment",
    filters: { company_id: req.params.id },
    fields: ["*"],
  })
  res.json({ payments: data || [], count: (data || []).length })
}

// POST /admin/companies/:id/payments — record a payment against this company
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = paymentSchema.parse({
    ...(req.body as Record<string, any>),
    company_id: req.params.id,
  })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createPayments(data as any)
  res.status(201).json({ payment: created })
}
