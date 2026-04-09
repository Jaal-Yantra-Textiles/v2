import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import PersonAgreementResponseLink from "../../../../../../../links/person-agreement-responses"

// GET /admin/persons/:id/agreements/:agreement_id/responses
// Returns agreementResponse records scoped to the given person and agreement
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const person_id = req.params.id as string
  const agreement_id = req.params.agreement_id as string
  if (!person_id || !agreement_id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Missing person_id or agreement_id")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)

  // Get this person's agreement responses via the link entry point
  const { data: responseLinks } = await query.graph({
    entity: PersonAgreementResponseLink.entryPoint,
    fields: ["person_id", "agreement_response_id", "agreement_response.*"],
    filters: { person_id },
  })

  // Filter to only responses for this specific agreement
  const responses = (responseLinks || [])
    .map((l: any) => l.agreement_response)
    .filter((r: any) => r?.agreement_id === agreement_id)

  return res.status(200).json({
    agreement_id,
    person_id,
    agreement_responses: responses,
    count: responses.length,
  })
}
