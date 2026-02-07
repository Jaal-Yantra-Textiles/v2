/**
 * @file Admin API routes for managing person agreements
 * @description Provides endpoints for retrieving specific agreements linked to persons in the JYT Commerce platform
 * @module API/Admin/Persons/Agreements
 */

/**
 * @typedef {Object} AgreementResponse
 * @property {string} id - The unique identifier of the agreement response
 * @property {string} status - The status of the response (e.g., "agreed", "accepted", "signed", "declined")
 * @property {Date} created_at - When the response was created
 * @property {Date} updated_at - When the response was last updated
 * @property {Object} person - The person who responded
 * @property {string} person.id - The unique identifier of the person
 * @property {string} person.first_name - The first name of the person
 * @property {string} person.last_name - The last name of the person
 * @property {string} person.email - The email of the person
 */

/**
 * @typedef {Object} Agreement
 * @property {string} id - The unique identifier of the agreement
 * @property {string} title - The title of the agreement
 * @property {string} content - The content of the agreement
 * @property {string} status - The status of the agreement (e.g., "active", "inactive")
 * @property {Date} created_at - When the agreement was created
 * @property {Date} updated_at - When the agreement was last updated
 * @property {Array<AgreementResponse>} responses - The responses to this agreement
 * @property {number} sent_count - The number of times this agreement was sent to the person
 * @property {number} response_count - The number of responses from the person
 * @property {number} agreed_count - The number of positive responses from the person
 */

/**
 * @typedef {Object} PersonAgreementResponse
 * @property {string} person_id - The unique identifier of the person
 * @property {string} person_name - The full name of the person
 * @property {string} person_email - The email of the person
 * @property {Agreement} agreement - The agreement details
 */

/**
 * Retrieve a specific agreement for a person
 * @route GET /admin/persons/{id}/agreements/{agreementId}
 * @group PersonAgreement - Operations related to person agreements
 * @param {string} id.path.required - The unique identifier of the person
 * @param {string} agreementId.path.required - The unique identifier of the agreement
 * @returns {PersonAgreementResponse} 200 - The agreement details for the person
 * @throws {MedusaError} 404 - Agreement not found for the person
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/persons/pers_123456789/agreements/agr_987654321
 *
 * @example response 200
 * {
 *   "person_id": "pers_123456789",
 *   "person_name": "John Doe",
 *   "person_email": "john.doe@example.com",
 *   "agreement": {
 *     "id": "agr_987654321",
 *     "title": "Terms of Service",
 *     "content": "This is the content of the terms of service agreement.",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "responses": [
 *       {
 *         "id": "resp_111222333",
 *         "status": "agreed",
 *         "created_at": "2023-01-02T00:00:00Z",
 *         "updated_at": "2023-01-02T00:00:00Z",
 *         "person": {
 *           "id": "pers_123456789",
 *           "first_name": "John",
 *           "last_name": "Doe",
 *           "email": "john.doe@example.com"
 *         }
 *       }
 *     ],
 *     "sent_count": 1,
 *     "response_count": 1,
 *     "agreed_count": 1
 *   }
 * }
 *
 * @example response 404
 * {
 *   "message": "Agreement with id \"agr_987654321\" not found for person \"pers_123456789\"",
 *   "code": "not_found",
 *   "type": "not_found"
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";

// GET /admin/persons/:id/agreements/:agreementId - Fetch a specific agreement for a person (Index-based)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id: person_id, agreementId: agreement_id } = req.params as { id: string; agreementId: string };
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // Fetch the specific agreement linked to this person
  const { data: agreements } = await query.index({
    entity: "agreement",
    fields: ["*", "people.*"],
    filters: {
      id: agreement_id,
      people: { id: person_id },
    },
  });

  if (!agreements || agreements.length === 0) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Agreement with id "${agreement_id}" not found for person "${person_id}"`
    );
  }

  const agreement = agreements[0] as any;
  const person = (agreement.people?.[0]) || {};

  // Fetch responses for this person for this agreement
  const { data: responses } = await query.index({
    entity: "agreementResponse",
    fields: ["*", "person.*"],
    filters: {
      person: { id: person_id },
      agreement_id,
    },
  });

  const resps = responses || [];
  const perPersonSent = resps.length;
  const perPersonAgreed = resps.filter((r: any) => ["agreed", "accepted", "signed"].includes((r?.status || "").toLowerCase())).length;

  res.status(200).json({
    person_id: person.id,
    person_name: `${person.first_name || ""} ${person.last_name || ""}`.trim(),
    person_email: person.email,
    agreement: {
      ...agreement,
      responses: resps,
      sent_count: perPersonSent,
      response_count: perPersonSent,
      agreed_count: perPersonAgreed,
    },
  });
};
