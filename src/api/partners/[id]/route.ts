/**
 * @file Partner API routes for managing partner people
 * @description Provides endpoints for retrieving and adding people to partners in the JYT Commerce platform
 * @module API/Partners/People
 */

/**
 * @typedef {Object} PartnerPeopleInput
 * @property {Array<Person>} people - Array of people to add to the partner
 */

/**
 * @typedef {Object} Person
 * @property {string} id - The unique identifier of the person
 * @property {string} first_name - The first name of the person
 * @property {string} last_name - The last name of the person
 * @property {string} email - The email address of the person
 * @property {string} role - The role of the person in the partner organization
 */

/**
 * @typedef {Object} PartnerResponse
 * @property {string} id - The unique identifier of the partner
 * @property {string} name - The name of the partner
 * @property {Array<Person>} people - Array of people associated with the partner
 * @property {Date} created_at - When the partner was created
 * @property {Date} updated_at - When the partner was last updated
 */

/**
 * Add people to a partner
 * @route POST /partners/:id
 * @group Partner - Operations related to partners
 * @param {string} id.path.required - The ID of the partner to add people to
 * @param {PartnerPeopleInput} request.body.required - People data to add to the partner
 * @returns {PartnerResponse} 200 - Updated partner object with added people
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 *
 * @example request
 * POST /partners/partner_123456789
 * {
 *   "people": [
 *     {
 *       "id": "person_123456789",
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "email": "john.doe@example.com",
 *       "role": "manager"
 *     }
 *   ]
 * }
 *
 * @example response 200
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Acme Corp",
 *     "people": [
 *       {
 *         "id": "person_123456789",
 *         "first_name": "John",
 *         "last_name": "Doe",
 *         "email": "john.doe@example.com",
 *         "role": "manager"
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z"
 *   }
 * }
 */

/**
 * Retrieve a partner with associated people
 * @route GET /partners/:id
 * @group Partner - Operations related to partners
 * @param {string} id.path.required - The ID of the partner to retrieve
 * @returns {PartnerResponse} 200 - Partner object with associated people
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Partner not found
 *
 * @example request
 * GET /partners/partner_123456789
 *
 * @example response 200
 * {
 *   "partner": {
 *     "id": "partner_123456789",
 *     "name": "Acme Corp",
 *     "people": [
 *       {
 *         "id": "person_123456789",
 *         "first_name": "John",
 *         "last_name": "Doe",
 *         "email": "john.doe@example.com",
 *         "role": "manager"
 *       }
 *     ],
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z"
 *   }
 * }
 */
import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PartnerPeopleSchema } from "./validators";
import { reFetchPartner } from "./helpers";
import { listPeopleOfPartner } from "../../../workflows/partner/list-partner-people";
import addPeoplePartnerWorkflow from "../../../workflows/partner/add-people-partner";

export const POST = async (
    req: AuthenticatedMedusaRequest<PartnerPeopleSchema>,
    res: MedusaResponse
) => {
    
    const partnerId = req.params.id
    const { people } = req.validatedBody

     await addPeoplePartnerWorkflow(req.scope).run({
        input: {
            partner_id: partnerId,
            people
        }
    })
    const partner = await reFetchPartner(partnerId, req.scope)
    res.json({
        partner: partner
    })
}

export const GET = async (
    req: AuthenticatedMedusaRequest,
    res: MedusaResponse
) => {
    const  partnerId = req.params.id
    const {result:partner} = await listPeopleOfPartner(req.scope).run({
        input: {
            partnerId: partnerId
        }
    })

    const partnerA = await reFetchPartner(partnerId, req.scope)
 
  
    res.json({
        partner: partner[0]
    })
}