import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { INVESTOR_MODULE } from "../../../../../modules/investor"
import type InvestorService from "../../../../../modules/investor/service"
import { documentSchema } from "../../../../investors/validators"

// GET /admin/cap-tables/:id/documents — compliance & financial documents.
// Optional ?document_type=kyc filter (used by the Compliance section).
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const filters: Record<string, unknown> = { cap_table_id: req.params.id }
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

// POST /admin/cap-tables/:id/documents — attach a document to this cap table.
// company_id is required by the schema; the caller passes it in the body.
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const data = documentSchema.parse({ ...(req.body as Record<string, any>), cap_table_id: req.params.id })
  const service: InvestorService = req.scope.resolve(INVESTOR_MODULE)
  const created = await service.createDocuments(data as any)
  res.status(201).json({ document: created })
}
