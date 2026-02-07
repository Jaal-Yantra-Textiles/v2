/**
 * @file Admin API routes for managing person types
 * @description Provides endpoints for creating and listing person types in the JYT Commerce platform
 * @module API/Admin/PersonTypes
 */

/**
 * @typedef {Object} PersonTypeInput
 * @property {string} name - The name of the person type
 * @property {string} [description] - Optional description of the person type
 * @property {string} [status] - Status of the person type (active/inactive)
 */

/**
 * @typedef {Object} PersonTypeResponse
 * @property {string} id - The unique identifier for the person type
 * @property {string} name - The name of the person type
 * @property {string} [description] - Optional description of the person type
 * @property {string} status - Status of the person type
 * @property {Date} created_at - When the person type was created
 * @property {Date} updated_at - When the person type was last updated
 */

/**
 * @typedef {Object} ListPersonTypesResponse
 * @property {PersonTypeResponse[]} personTypes - Array of person type objects
 * @property {number} count - Total count of person types matching filters
 * @property {number} offset - Current pagination offset
 * @property {number} limit - Current pagination limit
 * @property {boolean} hasMore - Whether more items are available
 */

/**
 * Create a new person type
 * @route POST /admin/persontypes
 * @group PersonType - Operations related to person types
 * @param {PersonTypeInput} request.body.required - Person type data to create
 * @returns {Object} 201 - Created person type object
 * @returns {PersonTypeResponse} 201.personType - The created person type
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * POST /admin/persontypes
 * {
 *   "name": "Customer",
 *   "description": "Standard customer type",
 *   "status": "active"
 * }
 *
 * @example response 201
 * {
 *   "personType": {
 *     "id": "pt_123456789",
 *     "name": "Customer",
 *     "description": "Standard customer type",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * List person types with pagination and filtering
 * @route GET /admin/persontypes
 * @group PersonType - Operations related to person types
 * @param {string} [q] - Search query to filter by name
 * @param {number} [offset=0] - Pagination offset
 * @param {number} [limit=10] - Number of items to return
 * @param {string} [status] - Filter by status (active/inactive)
 * @returns {ListPersonTypesResponse} 200 - Paginated list of person types
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * GET /admin/persontypes?offset=0&limit=10&q=Customer
 *
 * @example response 200
 * {
 *   "personTypes": [
 *     {
 *       "id": "pt_123456789",
 *       "name": "Customer",
 *       "description": "Standard customer type",
 *       "status": "active",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     },
 *     {
 *       "id": "pt_987654321",
 *       "name": "Vendor",
 *       "description": "Supplier or vendor type",
 *       "status": "active",
 *       "created_at": "2023-01-02T00:00:00Z",
 *       "updated_at": "2023-01-02T00:00:00Z"
 *     }
 *   ],
 *   "count": 2,
 *   "offset": 0,
 *   "limit": 10,
 *   "hasMore": false
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { createPersonTypeWorkflow } from "../../../workflows/person_type/create-person_type";
import { personTypeSchema, PersonTypeSchema } from "./validators";
import { MedusaError } from "@medusajs/framework/utils";

import {
  ListPersonTypesWorkFlowInput,
  listPersonTypeWorkflow,
} from "../../../workflows/person_type/list-person_type";


export const POST = async (
  req: MedusaRequest<PersonTypeSchema>,
  res: MedusaResponse,
) => {
  // Some routes might not have validator middleware wired; fall back safely
  const rawBody = (req as any).validatedBody ?? (req as any).body;

  const parsed = personTypeSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      parsed.error.errors?.[0]?.message || "Invalid person type payload"
    );
  }

  const { result } = await createPersonTypeWorkflow(req.scope).run({
    input: parsed.data,
  });
  res.status(201).json({ personType: result });
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { q, offset: offsetStr, limit: limitStr, ...filters } = req.query;

  const offset = parseInt(offsetStr as string) || 0;
  const limit = parseInt(limitStr as string) || 10;

  if (q) {
    filters.name = q;
  }

  const workflowInput: ListPersonTypesWorkFlowInput = {
    filters: filters,
    pagination: {
      offset,
      limit,
    },
  };
  const { result } = await listPersonTypeWorkflow(req.scope).run({
    input: workflowInput,
  });

  const [personTypes, count] = result;

  res.json({
    personTypes,
    count,
    offset,
    limit,
    hasMore: offset + personTypes.length < count,
  });
};
