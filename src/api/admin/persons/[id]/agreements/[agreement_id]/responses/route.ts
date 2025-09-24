import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"

// GET /admin/persons/:id/agreements/:agreement_id/responses
// Returns agreementResponse records scoped to the given person and agreement
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const person_id = req.params.id as string
    const agreement_id = req.params.agreement_id as string
    if (!person_id || !agreement_id) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing person_id or agreement_id")
    }

    const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

    // Use Index module to filter agreement responses by linked person
    // Requires the link person <-> agreementResponse to be ingested with filterable fields
    const { data: responses } = await query.index({
      entity: "agreementResponse",
      fields: ["*", "person.*"],
      filters: {
        person: { id: person_id },
        agreement_id,
      },
    })

    return res.status(200).json({
      agreement_id,
      person_id,
      agreement_responses: responses || [],
      count: (responses || []).length,
    })
  } catch (e: any) {
    if (e instanceof MedusaError) {
      const status = e.type === MedusaError.Types.INVALID_DATA ? 400 : 500
      return res.status(status).json({ message: e.message })
    }
    return res.status(500).json({ message: e?.message || "Unexpected error while fetching agreement responses" })
  }
}
