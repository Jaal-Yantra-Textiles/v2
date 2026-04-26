/**
 * @file Admin API routes for managing person types
 * @description Provides endpoints for retrieving, updating, and deleting person types in the JYT Commerce platform
 * @module API/Admin/PersonTypes
 */

/**
 * @typedef {Object} DeletePersonTypeInput
 * @property {string} id - The unique identifier of the person type to delete
 */

/**
 * @typedef {Object} DeletePersonTypeResponse
 * @property {string} id - The unique identifier of the deleted person type
 * @property {string} object - The type of object (always "personType")
 * @property {boolean} deleted - Indicates whether the deletion was successful
 */

/**
 * @typedef {Object} UpdatePersonTypeInput
 * @property {string} name - The name of the person type
 * @property {string} [description] - The description of the person type
 */

/**
 * @typedef {Object} PersonTypeResponse
 * @property {string} id - The unique identifier of the person type
 * @property {string} name - The name of the person type
 * @property {string} [description] - The description of the person type
 * @property {Date} created_at - When the person type was created
 * @property {Date} updated_at - When the person type was last updated
 */

/**
 * @typedef {Object} AdminPersonTypeResponse
 * @property {PersonTypeResponse} personType - The person type object
 */

/**
 * Delete a person type
 * @route DELETE /admin/persontypes/:id
 * @group PersonType - Operations related to person types
 * @param {string} id.path.required - The unique identifier of the person type to delete
 * @returns {DeletePersonTypeResponse} 200 - Success response indicating the person type was deleted
 * @throws {MedusaError} 404 - Person type not found
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * DELETE /admin/persontypes/pt_123456789
 *
 * @example response 200
 * {
 *   "id": "pt_123456789",
 *   "object": "personType",
 *   "deleted": true
 * }
 */

/**
 * Retrieve a person type
 * @route GET /admin/persontypes/:id
 * @group PersonType - Operations related to person types
 * @param {string} id.path.required - The unique identifier of the person type to retrieve
 * @returns {AdminPersonTypeResponse} 200 - The person type object
 * @throws {MedusaError} 404 - Person type not found
 *
 * @example request
 * GET /admin/persontypes/pt_123456789
 *
 * @example response 200
 * {
 *   "personType": {
 *     "id": "pt_123456789",
 *     "name": "Customer",
 *     "description": "Standard customer type",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Update a person type
 * @route POST /admin/persontypes/:id
 * @group PersonType - Operations related to person types
 * @param {string} id.path.required - The unique identifier of the person type to update
 * @param {UpdatePersonTypeInput} request.body.required - Person type data to update
 * @param {string[]} [fields] - Fields to include in the response (optional)
 * @returns {AdminPersonTypeResponse} 200 - The updated person type object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person type not found
 *
 * @example request
 * POST /admin/persontypes/pt_123456789
 * {
 *   "name": "VIP Customer",
 *   "description": "Premium customer type with special privileges"
 * }
 *
 * @example response 200
 * {
 *   "personType": {
 *     "id": "pt_123456789",
 *     "name": "VIP Customer",
 *     "description": "Premium customer type with special privileges",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-06-01T12:00:00Z"
 *   }
 * }
 */
import {
  AuthenticatedMedusaRequest,
  MedusaRequest,
  MedusaResponse,
} from "@medusajs/framework";
import { DeletePersonTypeSchema, UpdatePersonTypeSchema } from "../validators";
import { deletePersonTypeWorkflow } from "../../../../workflows/person_type/delete-person_type";
import { PERSON_TYPE_MODULE } from "../../../../modules/persontype";
import PersonTypeService from "../../../../modules/persontype/service";
import { PersonTypeAllowedFields, refetchPersonType } from "../helpers";
import { MedusaError } from "@medusajs/framework/utils";
import { updatePersonTypeWorkflow } from "../../../../workflows/person_type/update-person_type";
import { AdminPersonTypeResponse } from "../../../../admin/hooks/api/personandtype";

export const DELETE = async (
  req: MedusaRequest<DeletePersonTypeSchema>,
  res: MedusaResponse,
) => {
  const { id } = req.params;

  const { result, errors } = await deletePersonTypeWorkflow(req.scope).run({
    input: {
      id: id,
    },
  });
  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  }
  res.status(200).json({
    id,
    object: "personType",
    deleted: true,
  });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const personTypeService: PersonTypeService =
    req.scope.resolve(PERSON_TYPE_MODULE);
  const { id } = req.params;

  try {
    const personType = await personTypeService.retrievePersonType(id);
    res.status(200).json({ personType });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
};

export const POST = async (
  req: AuthenticatedMedusaRequest<UpdatePersonTypeSchema> & {
    remoteQueryConfig?: {
      fields?: PersonTypeAllowedFields[];
    };
  },
  res: MedusaResponse<AdminPersonTypeResponse>,
) => {
  const existingPersonType = await refetchPersonType(req.params.id, req.scope, [
    "id",
  ]);

  if (!existingPersonType) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Person type with id "${req.params.id}" not found`,
    );
  }

  const { result } = await updatePersonTypeWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      name: req.validatedBody.name,
      description: req.validatedBody.description,
    },
  });

  const fieldsToFetch: PersonTypeAllowedFields[] =
    req.remoteQueryConfig?.fields || [];
    
  const personType = await refetchPersonType(
    result.id,
    req.scope,
    fieldsToFetch,
  );

  res.status(200).json({ personType: personType });
};
