/**
 * @file Admin API routes for managing persons
 * @description Provides endpoints for retrieving, updating, and deleting person records in the JYT Commerce platform
 * @module API/Admin/Persons
 */

/**
 * @typedef {Object} PersonResponse
 * @property {string} id - The unique identifier for the person
 * @property {string} first_name - The person's first name
 * @property {string} last_name - The person's last name
 * @property {string} email - The person's email address
 * @property {string} phone - The person's phone number
 * @property {Date} created_at - When the person record was created
 * @property {Date} updated_at - When the person record was last updated
 * @property {Object} metadata - Additional metadata about the person
 */

/**
 * @typedef {Object} AdminUpdatePerson
 * @property {string} [first_name] - The person's first name
 * @property {string} [last_name] - The person's last name
 * @property {string} [email] - The person's email address
 * @property {string} [phone] - The person's phone number
 * @property {Object} [metadata] - Additional metadata about the person
 */

/**
 * @typedef {Object} DeleteResponse
 * @property {string} id - The unique identifier of the deleted person
 * @property {string} object - The type of object deleted (always "person")
 * @property {boolean} deleted - Whether the deletion was successful
 */

/**
 * Retrieve a single person by ID
 * @route GET /admin/persons/:id
 * @group Person - Operations related to persons
 * @param {string} id.path.required - The ID of the person to retrieve
 * @param {Object} [queryConfig] - Query configuration for filtering and pagination
 * @returns {Object} 200 - The person object
 * @returns {PersonResponse} 200.person - The person data
 * @throws {MedusaError} 404 - Person not found
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * GET /admin/persons/pers_123456789
 *
 * @example response 200
 * {
 *   "person": {
 *     "id": "pers_123456789",
 *     "first_name": "John",
 *     "last_name": "Doe",
 *     "email": "john.doe@example.com",
 *     "phone": "+1234567890",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "metadata": {}
 *   }
 * }
 */

/**
 * Update a person by ID
 * @route POST /admin/persons/:id
 * @group Person - Operations related to persons
 * @param {string} id.path.required - The ID of the person to update
 * @param {AdminUpdatePerson} request.body.required - Person data to update
 * @param {Object} [remoteQueryConfig] - Configuration for remote queries
 * @param {string[]} [remoteQueryConfig.fields] - Fields to include in the response
 * @returns {Object} 201 - The updated person object
 * @returns {PersonResponse} 201.person - The updated person data
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * POST /admin/persons/pers_123456789
 * {
 *   "first_name": "Jane",
 *   "last_name": "Doe",
 *   "email": "jane.doe@example.com",
 *   "metadata": {
 *     "preferred_contact": "email"
 *   }
 * }
 *
 * @example response 201
 * {
 *   "person": {
 *     "id": "pers_123456789",
 *     "first_name": "Jane",
 *     "last_name": "Doe",
 *     "email": "jane.doe@example.com",
 *     "phone": "+1234567890",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-02T00:00:00Z",
 *     "metadata": {
 *       "preferred_contact": "email"
 *     }
 *   }
 * }
 */

/**
 * Delete a person by ID
 * @route DELETE /admin/persons/:id
 * @group Person - Operations related to persons
 * @param {string} id.path.required - The ID of the person to delete
 * @returns {DeleteResponse} 201 - Confirmation of deletion
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * DELETE /admin/persons/pers_123456789
 *
 * @example response 201
 * {
 *   "id": "pers_123456789",
 *   "object": "person",
 *   "deleted": true
 * }
 */
// src/api/admin/persons/[id]/route.ts
import { MedusaRequest, MedusaResponse, refetchEntity } from "@medusajs/framework/http";
import PersonService from "../../../../modules/person/service";
import { PERSON_MODULE } from "../../../../modules/person";
import updatePersonWorkflow from "../../../../workflows/update-person";
import { PersonAllowedFields, refetchPerson } from "../helpers";

import { MedusaError } from "@medusajs/framework/utils";
import { AdminUpdatePerson } from "../../../../admin/hooks/api/personandtype";
import listSinglePersonWorkflow from "../../../../workflows/persons/list-single-person";
import deletePersonWorkflow from "../../../../workflows/delete-person";

export const GET = async (req: MedusaRequest , res: MedusaResponse) => {
  const { id } = req.params;
  const { result: person } = await listSinglePersonWorkflow(req.scope).run({
    input: {
      id,
      ...req.queryConfig
    },
  });
  res.status(200).json({ person });
};

export const POST = async (
  req: MedusaRequest<AdminUpdatePerson> & {
    remoteQueryConfig?: {
      fields?: PersonAllowedFields[];
    };
  },
  res: MedusaResponse,
) => {
  const {  ...update } = req.validatedBody
  const existingPerson = await refetchEntity({
    entity: "person",
    idOrFilter: req.params.id,
    scope: req.scope,
    fields: ["id"]
  })

  /**
   * Check if the person exists with the id or not before calling the workflow.
   */
  if (!existingPerson) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Person with id "${req.params.id}" not found`
    )
  }


  const { result, errors, transaction } = await updatePersonWorkflow.run({
    input: {
      id: req.params.id,
      update: update
    },
  });
  if (errors.length > 1) {
    console.warn("Error reported at", errors);
    throw errors;
  } 
  const person = await refetchPerson(
    result.id, 
    req.scope,
    req.remoteQueryConfig?.fields || ["*"],
  );
  res.status(201).json({ person });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
    const {result, errors} = await  deletePersonWorkflow(req.scope).run({
      input: {
        id,
      },
    });
    if (errors.length > 1) {
      console.warn("Error reported at", errors);
      throw errors;
    }
    res.status(201).json({
      id,
      object: "person",
      deleted: true,
    });
};
