/**
 * @file Admin API routes for managing person types
 * @description Provides endpoints for associating person types with persons in the JYT Commerce platform
 * @module API/Admin/Persons
 */

/**
 * @typedef {Object} AdminPostPersonTypesReq
 * @property {string[]} personTypeIds - Array of person type IDs to associate with the person
 */

/**
 * @typedef {Object} PersonTypeLink
 * @property {string} person_id - The ID of the person
 * @property {string} person_type_id - The ID of the associated person type
 * @property {Date} created_at - When the association was created
 */

/**
 * @typedef {Object} PersonTypesLinkResponse
 * @property {PersonTypeLink[]} list - Array of person-type associations
 * @property {number} count - Number of associations created
 */

/**
 * @typedef {Object} PostPersonTypesResponse
 * @property {PersonTypesLinkResponse} personTypesLink - Details of the created associations
 * @property {string} message - Success message with association details
 * @property {number} originalCount - Original count of person type IDs in request
 * @property {number} processedCount - Count of person type IDs after duplicate removal
 */

/**
 * Associate person types with a person
 * @route POST /admin/persons/:id/types
 * @group Person - Operations related to persons
 * @param {string} id.path.required - The ID of the person to associate types with
 * @param {AdminPostPersonTypesReq} request.body.required - Person type IDs to associate
 * @returns {PostPersonTypesResponse} 200 - Successfully associated person types
 * @throws {MedusaError} 400 - Invalid input data or duplicate IDs
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found or person types not found
 *
 * @example request
 * POST /admin/persons/pers_123456789/types
 * {
 *   "personTypeIds": ["type_123", "type_456", "type_789"]
 * }
 *
 * @example response 200
 * {
 *   "personTypesLink": {
 *     "list": [
 *       {
 *         "person_id": "pers_123456789",
 *         "person_type_id": "type_123",
 *         "created_at": "2023-01-01T00:00:00Z"
 *       },
 *       {
 *         "person_id": "pers_123456789",
 *         "person_type_id": "type_456",
 *         "created_at": "2023-01-01T00:00:00Z"
 *       },
 *       {
 *         "person_id": "pers_123456789",
 *         "person_type_id": "type_789",
 *         "created_at": "2023-01-01T00:00:00Z"
 *       }
 *     ],
 *     "count": 3
 *   },
 *   "message": "Person pers_123456789 successfully associated with 3 types",
 *   "originalCount": 3,
 *   "processedCount": 3
 * }
 *
 * @example response 200 (with duplicates)
 * {
 *   "personTypesLink": {
 *     "list": [
 *       {
 *         "person_id": "pers_123456789",
 *         "person_type_id": "type_123",
 *         "created_at": "2023-01-01T00:00:00Z"
 *       },
 *       {
 *         "person_id": "pers_123456789",
 *         "person_type_id": "type_456",
 *         "created_at": "2023-01-01T00:00:00Z"
 *       }
 *     ],
 *     "count": 2
 *   },
 *   "message": "Person pers_123456789 successfully associated with 2 types (duplicate IDs were removed)",
 *   "originalCount": 3,
 *   "processedCount": 2
 * }
 */
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework";
import { MedusaError } from "@medusajs/framework/utils";
import { refetchPersonType } from "./helpers";
import { AdminPostPersonTypesReq } from "./validators";
import associatePersonTypesWorkflow from "../../../../../workflows/persons/associate-person-types";

export const POST = async(req: MedusaRequest, res: MedusaResponse) => {
    const { id } = req.params

    // Validate person exists
    const personExist = await refetchEntity({
        entity: "person",
        idOrFilter: id,
        scope: req.scope,
        fields: ["id"]
    })

    if (!personExist) { 
        throw new MedusaError(
            MedusaError.Types.NOT_FOUND,
            `Person with id "${id}" not found`
        );
    }

    // Validate request body and remove duplicates
    const originalBody = req.body as { personTypeIds?: string[] };
    const { personTypeIds } = AdminPostPersonTypesReq.parse(req.body);
    
    // Check if duplicates were removed
    const hasDuplicates = originalBody.personTypeIds?.length !== personTypeIds.length;

    // Check if all personTypes exist
    await refetchPersonType(personTypeIds, req.scope);

    const { result:list } = await associatePersonTypesWorkflow(req.scope).run({
        input: {
            personId: id,
            typeIds: personTypeIds
        }
    })
    return res.status(200).json({
        personTypesLink: {
            list,
            count: list[0].length
        },
        message: `Person ${id} successfully associated with ${list[0].length} types${hasDuplicates ? ' (duplicate IDs were removed)' : ''}`,
        originalCount: originalBody.personTypeIds?.length ?? 0,
        processedCount: personTypeIds.length
    })
}