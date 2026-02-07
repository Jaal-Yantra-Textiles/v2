/**
 * @file Admin API routes for managing agreement responses
 * @description Provides endpoints for retrieving agreement responses for a specific person and agreement in the JYT Commerce platform
 * @module API/Admin/AgreementResponses
 */

/**
 * @typedef {Object} AgreementResponse
 * @property {string} id - The unique identifier of the agreement response
 * @property {string} agreement_id - The ID of the associated agreement
 * @property {string} person_id - The ID of the person who responded
 * @property {string} response - The response content
 * @property {Date} created_at - When the response was created
 * @property {Date} updated_at - When the response was last updated
 * @property {Object} person - The associated person object
 * @property {string} person.id - The unique identifier of the person
 * @property {string} person.first_name - The first name of the person
 * @property {string} person.last_name - The last name of the person
 * @property {string} person.email - The email address of the person
 */

/**
 * @typedef {Object} AgreementResponsesResponse
 * @property {string} agreement_id - The ID of the agreement
 * @property {string} person_id - The ID of the person
 * @property {AgreementResponse[]} agreement_responses - Array of agreement responses
 * @property {number} count - Total count of agreement responses
 */

/**
 * Retrieve agreement responses for a specific person and agreement
 * @route GET /admin/persons/:id/agreements/:agreement_id/responses
 * @group AgreementResponse - Operations related to agreement responses
 * @param {string} id.path.required - The ID of the person
 * @param {string} agreement_id.path.required - The ID of the agreement
 * @returns {AgreementResponsesResponse} 200 - Agreement responses for the specified person and agreement
 * @throws {MedusaError} 400 - Missing person_id or agreement_id
 * @throws {MedusaError} 500 - Unexpected error while fetching agreement responses
 *
 * @example request
 * GET /admin/persons/pers_123456789/agreements/agr_987654321/responses
 *
 * @example response 200
 * {
 *   "agreement_id": "agr_987654321",
 *   "person_id": "pers_123456789",
 *   "agreement_responses": [
 *     {
 *       "id": "resp_111111111",
 *       "agreement_id": "agr_987654321",
 *       "person_id": "pers_123456789",
 *       "response": "I agree to the terms and conditions",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "person": {
 *         "id": "pers_123456789",
 *         "first_name": "John",
 *         "last_name": "Doe",
 *         "email": "john.doe@example.com"
 *       }
 *     }
 *   ],
 *   "count": 1
 * }
 *
 * @example response 400
 * {
 *   "message": "Missing person_id or agreement_id"
 * }
 *
 * @example response 500
 * {
 *   "message": "Unexpected error while fetching agreement responses"
 * }
 */
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
