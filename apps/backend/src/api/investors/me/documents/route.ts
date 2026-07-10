import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { requireInvestor } from "../../helpers"

// GET /investors/me/documents — compliance / legal documents the investor is
// allowed to view: documents belonging to companies the investor is linked to
// (via the pipeline) whose visibility is "investor" or "public".
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const investor = await requireInvestor(req.auth_context, req.scope)
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  const { data: pipelines } = await query.graph({
    entity: "investor_pipeline",
    filters: { investor_id: investor.id },
    fields: ["company_id"],
  })
  const companyIds = [
    ...new Set((pipelines || []).map((p: any) => p.company_id).filter(Boolean)),
  ]
  if (!companyIds.length) {
    return res.json({ documents: [], count: 0 })
  }

  const { data: documents } = await query.graph({
    entity: "investor_document",
    filters: {
      company_id: companyIds,
      visibility: ["investor", "public"],
    },
    fields: [
      "id",
      "title",
      "description",
      "document_type",
      "file_url",
      "file_name",
      "visibility",
      "company_id",
      "created_at",
    ],
  })

  res.json({ documents: documents || [], count: (documents || []).length })
}
