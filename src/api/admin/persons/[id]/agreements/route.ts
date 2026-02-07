/**
 * @file Admin API routes for managing person agreements
 * @description Provides endpoints for retrieving agreements and responses for a specific person in the JYT Commerce platform
 * @module API/Admin/Persons/Agreements
 */

/**
 * @typedef {Object} Agreement
 * @property {string} id - The unique identifier of the agreement
 * @property {string} title - The title of the agreement
 * @property {string} content - The content of the agreement
 * @property {string} status - The status of the agreement (active/inactive)
 * @property {Date} created_at - When the agreement was created
 * @property {Date} updated_at - When the agreement was last updated
 */

/**
 * @typedef {Object} AgreementResponse
 * @property {string} id - The unique identifier of the agreement response
 * @property {string} agreement_id - The ID of the agreement this response belongs to
 * @property {string} person_id - The ID of the person who responded
 * @property {string} status - The status of the response (agreed, declined, pending, etc.)
 * @property {Date} created_at - When the response was created
 * @property {Date} updated_at - When the response was last updated
 */

/**
 * @typedef {Object} PersonAgreementResponse
 * @property {string} person_id - The unique identifier of the person
 * @property {string} person_name - The full name of the person
 * @property {string} person_email - The email address of the person
 * @property {Array<AgreementWithResponses>} agreements - List of agreements with their responses
 * @property {number} count - Total number of agreements for this person
 */

/**
 * @typedef {Object} AgreementWithResponses
 * @property {string} id - The unique identifier of the agreement
 * @property {string} title - The title of the agreement
 * @property {string} content - The content of the agreement
 * @property {string} status - The status of the agreement
 * @property {Date} created_at - When the agreement was created
 * @property {Date} updated_at - When the agreement was last updated
 * @property {Array<AgreementResponse>} responses - List of responses for this agreement
 * @property {number} sent_count - Number of times this agreement was sent to the person
 * @property {number} response_count - Number of responses for this agreement
 * @property {number} agreed_count - Number of positive responses (agreed/accepted/signed)
 */

/**
 * Get all agreements and responses for a specific person
 * @route GET /admin/persons/{id}/agreements
 * @group Person - Operations related to persons
 * @param {string} id.path.required - The ID of the person to fetch agreements for
 * @returns {PersonAgreementResponse} 200 - Person's agreements with responses and counters
 * @throws {MedusaError} 400 - Invalid person ID
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/persons/pers_123456789/agreements
 *
 * @example response 200
 * {
 *   "person_id": "pers_123456789",
 *   "person_name": "John Doe",
 *   "person_email": "john.doe@example.com",
 *   "agreements": [
 *     {
 *       "id": "agr_987654321",
 *       "title": "Terms of Service",
 *       "content": "Full terms and conditions...",
 *       "status": "active",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "responses": [
 *         {
 *           "id": "resp_111222333",
 *           "agreement_id": "agr_987654321",
 *           "person_id": "pers_123456789",
 *           "status": "agreed",
 *           "created_at": "2023-01-02T10:00:00Z",
 *           "updated_at": "2023-01-02T10:00:00Z"
 *         }
 *       ],
 *       "sent_count": 1,
 *       "response_count": 1,
 *       "agreed_count": 1
 *     },
 *     {
 *       "id": "agr_555666777",
 *       "title": "Privacy Policy",
 *       "content": "Privacy policy content...",
 *       "status": "active",
 *       "created_at": "2023-01-03T00:00:00Z",
 *       "updated_at": "2023-01-03T00:00:00Z",
 *       "responses": [],
 *       "sent_count": 0,
 *       "response_count": 0,
 *       "agreed_count": 0
 *     }
 *   ],
 *   "count": 2
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import PersonAgreementLink from "../../../../../links/person-agreements";
import PersonAgreementResponseLink from "../../../../../links/person-agreement-responses";

// GET /admin/persons/:id/agreements - Fetch all agreements for a person
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  // 1) Fetch agreements for this person via module link (graph)
  const { data: agreementData } = await query.graph({
    entity: PersonAgreementLink.entryPoint,
    fields: ["agreement.*", "person.*"],
    filters: { person_id },
  });

  if (!agreementData || agreementData.length === 0) {
    return res.status(200).json({
      person_id,
      person_name: "",
      person_email: "",
      agreements: [],
      count: 0,
    });
  }

  const personInfo = agreementData[0].person;
  const agreements = agreementData.map((rec: any) => rec.agreement);

  // 2) Fetch agreement responses for this person via module link (graph)
  const { data: responseData } = await query.graph({
    entity: PersonAgreementResponseLink.entryPoint,
    fields: ["agreement_response.*", "person.*"],
    filters: { person_id },
  });

  // Group responses by agreement_id for easier access
  const responsesByAgreement: Record<string, any[]> = {};
  for (const rec of responseData || []) {
    const ar = rec.agreement_response;
    const agreementId = ar.agreement_id;
    if (!responsesByAgreement[agreementId]) {
      responsesByAgreement[agreementId] = [];
    }
    responsesByAgreement[agreementId].push(ar);
  }

  // Attach responses and compute per-person counters
  const agreementsWithResponses = agreements.map((agreement: any) => {
    const resps = responsesByAgreement[agreement.id] || [];
    const perPersonSent = resps.length;
    const perPersonAgreed = resps.filter((r: any) => ["agreed", "accepted", "signed"].includes((r?.status || "").toLowerCase())).length;
    return {
      ...agreement,
      responses: resps,
      sent_count: perPersonSent,
      response_count: perPersonSent,
      agreed_count: perPersonAgreed,
    };
  });

  res.status(200).json({
    person_id: personInfo.id,
    person_name: `${personInfo.first_name || ""} ${personInfo.last_name || ""}`.trim(),
    person_email: personInfo.email,
    agreements: agreementsWithResponses,
    count: agreementsWithResponses.length,
  });
};
