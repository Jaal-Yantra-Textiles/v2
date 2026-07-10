import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { documentSchema } from "../../../../investors/validators"

// GET /admin/companies/:id/documents — company document vault (Compliance).
// Optional ?document_type=kyc filter.
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const filters: Record<string, unknown> = { company_id: req.params.id }
  const documentType = req.query.document_type
  if (typeof documentType === "string" && documentType) {
    filters.document_type = documentType
  }
  const { data } = await query.graph({
    entity: "investor_document",
    filters,
    fields: ["*"],
  })
  res.json({ documents: data || [], count: (data || []).length })
}

// POST /admin/companies/:id/documents — record a compliance/financial document.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = documentSchema.parse({
    ...(req.body as Record<string, any>),
    company_id: req.params.id,
  })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createDocuments(data as any)
  res.status(201).json({ document: created })
}
