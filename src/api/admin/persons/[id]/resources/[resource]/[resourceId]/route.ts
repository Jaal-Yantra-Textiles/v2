/**
 * @file Admin API routes for managing person resources
 * @description Provides endpoints for retrieving, updating, and deleting resources associated with a person in the JYT Commerce platform
 * @module API/Admin/Persons/Resources
 */

/**
 * @typedef {Object} PersonResourceUpdateInput
 * @property {Object} [payload] - The update payload specific to the resource type
 * @description The exact structure depends on the resource type being updated
 */

/**
 * @typedef {Object} PersonResourceResponse
 * @property {string} id - The unique identifier of the resource
 * @property {string} person_id - The ID of the associated person
 * @property {string} resource - The type of resource
 * @property {boolean} deleted - Whether the resource was successfully deleted
 */

/**
 * Retrieve a specific resource associated with a person
 * @route GET /admin/persons/:id/resources/:resource/:resourceId
 * @group Person Resources - Operations related to person resources
 * @param {string} id.path.required - The ID of the person
 * @param {string} resource.path.required - The type of resource to retrieve
 * @param {string} resourceId.path.required - The ID of the resource to retrieve
 * @returns {Object} 200 - The requested resource object
 * @throws {MedusaError} 400 - Invalid resource type or retrieval not supported
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person or resource not found
 *
 * @example request
 * GET /admin/persons/person_123/resources/webhook/web_456
 *
 * @example response 200
 * {
 *   "webhook": {
 *     "id": "web_456",
 *     "person_id": "person_123",
 *     "url": "https://example.com/webhook",
 *     "status": "active",
 *     "created_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Update a specific resource associated with a person
 * @route PATCH /admin/persons/:id/resources/:resource/:resourceId
 * @group Person Resources - Operations related to person resources
 * @param {string} id.path.required - The ID of the person
 * @param {string} resource.path.required - The type of resource to update
 * @param {string} resourceId.path.required - The ID of the resource to update
 * @param {PersonResourceUpdateInput} request.body.required - The update payload
 * @returns {Object} 200 - The updated resource object
 * @throws {MedusaError} 400 - Invalid resource type, update not supported, or invalid payload
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person or resource not found
 *
 * @example request
 * PATCH /admin/persons/person_123/resources/webhook/web_456
 * {
 *   "url": "https://example.com/new-webhook",
 *   "status": "inactive"
 * }
 *
 * @example response 200
 * {
 *   "webhook": {
 *     "id": "web_456",
 *     "person_id": "person_123",
 *     "url": "https://example.com/new-webhook",
 *     "status": "inactive",
 *     "updated_at": "2023-01-02T00:00:00Z"
 *   }
 * }
 */

/**
 * Delete a specific resource associated with a person
 * @route DELETE /admin/persons/:id/resources/:resource/:resourceId
 * @group Person Resources - Operations related to person resources
 * @param {string} id.path.required - The ID of the person
 * @param {string} resource.path.required - The type of resource to delete
 * @param {string} resourceId.path.required - The ID of the resource to delete
 * @returns {PersonResourceResponse} 200 - Confirmation of deletion
 * @throws {MedusaError} 400 - Invalid resource type or deletion not supported
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Person or resource not found
 *
 * @example request
 * DELETE /admin/persons/person_123/resources/webhook/web_456
 *
 * @example response 200
 * {
 *   "id": "web_456",
 *   "person_id": "person_123",
 *   "resource": "webhook",
 *   "deleted": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { getPersonResourceDefinition } from "../../../../resources/registry"

const resolveResourceOrThrow = (resourceKey: string) => {
  const resource = getPersonResourceDefinition(resourceKey)

  if (!resource) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Unsupported person resource "${resourceKey}"`,
    )
  }

  return resource
}

export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const {
    id: personId,
    resource: resourceKey,
    resourceId,
  } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.retrieve) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Retrieving is not supported for resource "${resourceKey}"`,
    )
  }

  const retrieved = await resource.handlers.retrieve({
    scope: req.scope,
    personId,
    resourceId,
  })

  res.status(200).json({
    [resource.itemKey]: retrieved,
  })
}

export const PATCH = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const {
    id: personId,
    resource: resourceKey,
    resourceId,
  } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.update) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Updating is not supported for resource "${resourceKey}"`,
    )
  }

  const payload = resource.validators?.update
    ? resource.validators.update.parse(req.body)
    : req.body

  const updated = await resource.handlers.update({
    scope: req.scope,
    personId,
    resourceId,
    payload,
  })

  res.status(200).json({
    [resource.itemKey]: updated,
  })
}

export const DELETE = async (
  req: MedusaRequest,
  res: MedusaResponse,
) => {
  const {
    id: personId,
    resource: resourceKey,
    resourceId,
  } = req.params
  const resource = resolveResourceOrThrow(resourceKey)

  if (!resource.handlers.delete) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Deletion is not supported for resource "${resourceKey}"`,
    )
  }

  await resource.handlers.delete({
    scope: req.scope,
    personId,
    resourceId,
  })

  res.status(200).json({
    id: resourceId,
    person_id: personId,
    resource: resourceKey,
    deleted: true,
  })
}
