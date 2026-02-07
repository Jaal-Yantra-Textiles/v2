/**
 * @file Admin API route for sending agreements to persons
 * @description Provides endpoints for sending agreements to single or multiple signers in the JYT Commerce platform
 * @module API/Admin/Persons/Agreements
 */

/**
 * @typedef {Object} AdminSendPersonAgreementReq
 * @property {string} agreement_id - The ID of the agreement to be sent
 * @property {string[]} [person_ids] - Optional array of additional person IDs to send the agreement to
 * @property {string} template_key - The key of the email template to use for sending the agreement
 */

/**
 * @typedef {Object} AgreementResponse
 * @property {string} id - The unique identifier of the agreement response
 * @property {string} agreement_id - The ID of the agreement
 * @property {string} person_id - The ID of the person who responded
 * @property {string} status - The status of the agreement response
 * @property {Date} created_at - When the agreement response was created
 */

/**
 * @typedef {Object} PersonAgreementLink
 * @property {string} id - The unique identifier of the person agreement link
 * @property {string} person_id - The ID of the person
 * @property {string} agreement_id - The ID of the agreement
 * @property {string} token - The unique token for accessing the agreement
 * @property {Date} expires_at - When the link expires
 */

/**
 * @typedef {Object} EmailResult
 * @property {string} person_id - The ID of the person the email was sent to
 * @property {boolean} success - Whether the email was sent successfully
 * @property {string} [error] - Error message if the email failed to send
 */

/**
 * @typedef {Object} StatsUpdated
 * @property {string} person_id - The ID of the person whose stats were updated
 * @property {string} agreement_id - The ID of the agreement
 * @property {Date} updated_at - When the stats were updated
 */

/**
 * @typedef {Object} SendAgreementResponse
 * @property {string} message - Success message
 * @property {string} agreement_id - The ID of the agreement sent
 * @property {string[]} person_ids - Array of person IDs the agreement was sent to
 * @property {AgreementResponse[]} agreement_responses - Array of agreement responses
 * @property {PersonAgreementLink[]} person_agreement_links - Array of person agreement links
 * @property {EmailResult[]} email_results - Array of email sending results
 * @property {StatsUpdated[]} stats_updated - Array of stats update records
 */

/**
 * @typedef {Object} SendAgreementSingleResponse
 * @property {string} message - Success message
 * @property {string} person_id - The ID of the person the agreement was sent to
 * @property {string} agreement_id - The ID of the agreement sent
 * @property {AgreementResponse} agreement_response - The agreement response
 * @property {PersonAgreementLink} person_agreement_link - The person agreement link
 * @property {EmailResult} email_result - The email sending result
 * @property {StatsUpdated[]} stats_updated - Array of stats update records
 */

/**
 * Send an agreement to a person (single or multiple signers)
 * @route POST /admin/persons/:id/agreements/send
 * @group Person Agreements - Operations related to person agreements
 * @param {string} id.path.required - The ID of the primary person to send the agreement to
 * @param {AdminSendPersonAgreementReq} request.body.required - Agreement sending data
 * @returns {SendAgreementResponse} 200 - Agreement sent successfully to all signers
 * @returns {SendAgreementSingleResponse} 200 - Agreement sent successfully to single signer
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person or agreement not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request - Single signer
 * POST /admin/persons/pers_123456789/agreements/send
 * {
 *   "agreement_id": "agr_987654321",
 *   "template_key": "standard_agreement"
 * }
 *
 * @example response 200 - Single signer
 * {
 *   "message": "Agreement sent successfully",
 *   "person_id": "pers_123456789",
 *   "agreement_id": "agr_987654321",
 *   "agreement_response": {
 *     "id": "agr_resp_111222333",
 *     "agreement_id": "agr_987654321",
 *     "person_id": "pers_123456789",
 *     "status": "pending",
 *     "created_at": "2023-01-01T00:00:00Z"
 *   },
 *   "person_agreement_link": {
 *     "id": "link_444555666",
 *     "person_id": "pers_123456789",
 *     "agreement_id": "agr_987654321",
 *     "token": "abc123xyz456",
 *     "expires_at": "2023-01-08T00:00:00Z"
 *   },
 *   "email_result": {
 *     "person_id": "pers_123456789",
 *     "success": true
 *   },
 *   "stats_updated": [
 *     {
 *       "person_id": "pers_123456789",
 *       "agreement_id": "agr_987654321",
 *       "updated_at": "2023-01-01T00:00:01Z"
 *     }
 *   ]
 * }
 *
 * @example request - Multiple signers
 * POST /admin/persons/pers_123456789/agreements/send
 * {
 *   "agreement_id": "agr_987654321",
 *   "person_ids": ["pers_987654321", "pers_555666777"],
 *   "template_key": "standard_agreement"
 * }
 *
 * @example response 200 - Multiple signers
 * {
 *   "message": "Agreement sent successfully to all signers",
 *   "agreement_id": "agr_987654321",
 *   "person_ids": ["pers_123456789", "pers_987654321", "pers_555666777"],
 *   "agreement_responses": [
 *     {
 *       "id": "agr_resp_111222333",
 *       "agreement_id": "agr_987654321",
 *       "person_id": "pers_123456789",
 *       "status": "pending",
 *       "created_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "agr_resp_444555666",
 *       "agreement_id": "agr_987654321",
 *       "person_id": "pers_987654321",
 *       "status": "pending",
 *       "created_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "agr_resp_777888999",
 *       "agreement_id": "agr_987654321",
 *       "person_id": "pers_555666777",
 *       "status": "pending",
 *       "created_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "person_agreement_links": [
 *     {
 *       "id": "link_111222333",
 *       "person_id": "pers_123456789",
 *       "agreement_id": "agr_987654321",
 *       "token": "abc123xyz456",
 *       "expires_at": "2023-01-08T00:00:00Z"
 *     },
 *     {
 *       "id": "link_444555666",
 *       "person_id": "pers_987654321",
 *       "agreement_id": "agr_987654321",
 *       "token": "def456ghi789",
 *       "expires_at": "2023-01-08T00:00:00Z"
 *     },
 *     {
 *       "id": "link_777888999",
 *       "person_id": "pers_555666777",
 *       "agreement_id": "agr_987654321",
 *       "token": "jkl012mno345",
 *       "expires_at": "2023-01-08T00:00:00Z"
 *     }
 *   ],
 *   "email_results": [
 *     {
 *       "person_id": "pers_123456789",
 *       "success": true
 *     },
 *     {
 *       "person_id": "pers_987654321",
 *       "success": true
 *     },
 *     {
 *       "person_id": "pers_555666777",
 *       "success": true
 *     }
 *   ],
 *   "stats_updated": [
 *     {
 *       "person_id": "pers_123456789",
 *       "agreement_id": "agr_987654321",
 *       "updated_at": "2023-01-01T00:00:01Z"
 *     },
 *     {
 *       "person_id": "pers_987654321",
 *       "agreement_id": "agr_987654321",
 *       "updated_at": "2023-01-01T00:00:01Z"
 *     },
 *     {
 *       "person_id": "pers_555666777",
 *       "agreement_id": "agr_987654321",
 *       "updated_at": "2023-01-01T00:00:01Z"
 *     }
 *   ]
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { sendAgreementEmailWorkflow } from "../../../../../../workflows/agreements/send-agreement-email";
import { sendAgreementEmailMultiWorkflow } from "../../../../../../workflows/agreements/send-agreement-email-multi";
import { AdminSendPersonAgreementReq } from "../validators";

// POST /admin/persons/:id/agreements/send - Send an agreement to a person (single or multiple signers)
export const POST = async (
  req: MedusaRequest<AdminSendPersonAgreementReq>,
  res: MedusaResponse
) => {
  const { id: person_id } = req.params;
  const { agreement_id, person_ids, template_key } = req.validatedBody;
  // If person_ids is provided, use multi-signer workflow
  if (person_ids && person_ids.length > 0) {
    // Combine the primary person_id with additional person_ids
    const all_person_ids = [person_id, ...person_ids];
    
    // Execute the send agreement email multi workflow
    const { result } = await sendAgreementEmailMultiWorkflow(req.scope).run({
      input: {
        agreement_id,
        person_ids: all_person_ids,
        template_key
      }
    });

    const statsUpdated = Array.isArray(result.stats_updated)
      ? result.stats_updated
      : [result.stats_updated];

    res.status(200).json({
      message: "Agreement sent successfully to all signers",
      agreement_id,
      person_ids: all_person_ids,
      agreement_responses: result.agreement_responses,
      person_agreement_links: result.person_agreement_links,
      email_results: result.email_results,
      stats_updated: statsUpdated
    });
  } else {
    // Use single signer workflow for backward compatibility
    const { result } = await sendAgreementEmailWorkflow(req.scope).run({
      input: {
        person_id,
        agreement_id,
        template_key
      }
    });

    const statsUpdated = Array.isArray(result.stats_updated)
      ? result.stats_updated
      : [result.stats_updated];

    res.status(200).json({
      message: "Agreement sent successfully",
      person_id,
      agreement_id,
      agreement_response: result.agreement_response,
      person_agreement_link: result.person_agreement_link,
      email_result: result.email_result,
      stats_updated: statsUpdated
    });
  }
};
