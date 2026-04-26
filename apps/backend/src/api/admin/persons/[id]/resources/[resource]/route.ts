/**
 * @file Admin API routes for managing person resources
 * @description Provides endpoints for listing and creating resources associated with a person in the JYT Commerce platform
 * @module API/Admin/Persons/Resources
 */

/**
 * @typedef {Object} PersonResourceListQuery
 * @property {number} [offset=0] - Pagination offset
 * @property {number} [limit=10] - Number of items to return
 * @property {string} [fields] - Comma-separated list of fields to include in the response
 * @property {string} [order] - Field to order results by
 * @property {string} [expand] - Comma-separated list of relations to expand
 */

/**
 * @typedef {Object} PersonResourceListResponse
 * @property {Array<Object>} [resourceKey] - Array of resource items (key varies by resource type)
 * @property {number} count - Total count of items matching the query
 */

/**
 * @typedef {Object} PersonResourceCreatePayload
 * @property {string} name - The name of the resource
 * @property {string} [description] - Optional description of the resource
 * @property {string} [status] - Status of the resource (active/inactive)
 * @property {Object} [metadata] - Additional metadata associated with the resource
 */

/**
 * @typedef {Object} PersonResourceCreateResponse
 * @property {Object} [resourceKey] - The created resource item (key varies by resource type)
 * @property {string} resourceKey.id - The unique identifier of the created resource
 * @property {string} resourceKey.name - The name of the resource
 * @property {string} resourceKey.status - Status of the resource
 * @property {Date} resourceKey.created_at - When the resource was created
 * @property {Date} resourceKey.updated_at - When the resource was last updated
 * @property {Object} resourceKey.metadata - Additional metadata
 */

/**
 * List resources associated with a person
 * @route GET /admin/persons/:id/resources/:resource
 * @group Person Resources - Operations related to person resources
 * @param {string} id.path.required - The ID of the person
 * @param {string} resource.path.required - The type of resource to list (e.g., "webhooks", "designs")
 * @param {PersonResourceListQuery} query - Query parameters for pagination and filtering
 * @returns {PersonResourceListResponse} 200 - Paginated list of resources
 * @throws {MedusaError} 400 - Invalid resource type or unsupported list operation
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * GET /admin/persons/pers_123456789/resources/webhooks?offset=0&limit=10
 *
 * @example response 200
 * {
 *   "webhooks": [
 *     {
 *       "id": "web_123456789",
 *       "name": "Order Created Webhook",
 *       "status": "active",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z",
 *       "metadata": {}
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a new resource for a person
 * @route POST /admin/persons/:id/resources/:resource
 * @group Person Resources - Operations related to person resources
 * @param {string} id.path.required - The ID of the person
 * @param {string} resource.path.required - The type of resource to create (e.g., "webhooks", "designs")
 * @param {PersonResourceCreatePayload} request.body.required - Resource data to create
 * @returns {PersonResourceCreateResponse} 201 - Created resource object
 * @throws {MedusaError} 400 - Invalid input data or unsupported create operation
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person not found
 *
 * @example request
 * POST /admin/persons/pers_123456789/resources/designs
 * {
 *   "name": "Summer Collection Design",
 *   "description": "Design for the summer 2023 collection",
 *   "status": "active",
 *   "metadata": {
 *     "season": "summer",
 *     "year": 2023
 *   }
 * }
 *
 * @example response 201
 * {
 *   "design": {
 *     "id": "design_987654321",
 *     "name": "Summer Collection Design",
 *     "description": "Design for the summer 2023 collection",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z",
 *     "metadata": {
 *       "season": "summer",
 *       "year": 2023
 *     }
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { getPersonResourceDefinition } from "../../../resources/registry"

const resolveResourceOrThrow = (resourceKey: string) => {
  const resource = getPersonResourceDefinition(resourceKey)

  if (!resource) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unsupported person resource "${resourceKey}"`
    )
  }

  return resource
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { id: personId, resource: resourceKey } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.list) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Listing is not supported for resource "${resourceKey}"`,
    )
  }

  const result = await resource.handlers.list({
    scope: req.scope,
    personId,
    query: req.query,
  })

  res.status(200).json({
    [resource.listKey]: result.items,
    count: result.count,
  })
}

export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const { id: personId, resource: resourceKey } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.create) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Creation is not supported for resource "${resourceKey}"`,
    )
  }

  const payload = resource.validators?.create
    ? resource.validators.create.parse(req.body)
    : req.body

  const created = await resource.handlers.create({
    scope: req.scope,
    personId,
    payload,
  })

  res.status(201).json({
    [resource.itemKey]: created,
  })
}
