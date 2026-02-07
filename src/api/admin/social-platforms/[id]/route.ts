/**
 * @file Admin API routes for managing social platforms
 * @description Provides endpoints for retrieving, updating, and deleting social platforms in the JYT Commerce platform
 * @module API/Admin/SocialPlatforms
 */

/**
 * @typedef {Object} UpdateSocialPlatformInput
 * @property {string} [name] - The name of the social platform
 * @property {string} [icon] - The icon URL or identifier for the social platform
 * @property {string} [base_url] - The base URL for the social platform
 * @property {boolean} [is_active] - Whether the social platform is active
 * @property {Object} [metadata] - Additional metadata for the social platform
 */

/**
 * @typedef {Object} SocialPlatformResponse
 * @property {string} id - The unique identifier of the social platform
 * @property {string} name - The name of the social platform
 * @property {string} icon - The icon URL or identifier for the social platform
 * @property {string} base_url - The base URL for the social platform
 * @property {boolean} is_active - Whether the social platform is active
 * @property {Object} metadata - Additional metadata for the social platform
 * @property {Date} created_at - When the social platform was created
 * @property {Date} updated_at - When the social platform was last updated
 */

/**
 * Get a social platform by ID
 * @route GET /admin/social-platforms/:id
 * @group Social Platform - Operations related to social platforms
 * @param {string} id.path.required - The ID of the social platform to retrieve
 * @returns {Object} 200 - The requested social platform object
 * @throws {MedusaError} 400 - Invalid ID format
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social platform not found
 *
 * @example request
 * GET /admin/social-platforms/socplat_123456789
 *
 * @example response 200
 * {
 *   "socialPlatform": {
 *     "id": "socplat_123456789",
 *     "name": "Facebook",
 *     "icon": "https://example.com/icons/facebook.png",
 *     "base_url": "https://facebook.com",
 *     "is_active": true,
 *     "metadata": {},
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Update a social platform
 * @route POST /admin/social-platforms/:id
 * @group Social Platform - Operations related to social platforms
 * @param {string} id.path.required - The ID of the social platform to update
 * @param {UpdateSocialPlatformInput} request.body.required - Social platform data to update
 * @returns {Object} 200 - The updated social platform object
 * @throws {MedusaError} 400 - Invalid input data or ID format
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social platform not found
 *
 * @example request
 * POST /admin/social-platforms/socplat_123456789
 * {
 *   "name": "Meta",
 *   "icon": "https://example.com/icons/meta.png",
 *   "is_active": false
 * }
 *
 * @example response 200
 * {
 *   "socialPlatform": {
 *     "id": "socplat_123456789",
 *     "name": "Meta",
 *     "icon": "https://example.com/icons/meta.png",
 *     "base_url": "https://facebook.com",
 *     "is_active": false,
 *     "metadata": {},
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-06-01T00:00:00Z"
 *   }
 * }
 */

/**
 * Delete a social platform
 * @route DELETE /admin/social-platforms/:id
 * @group Social Platform - Operations related to social platforms
 * @param {string} id.path.required - The ID of the social platform to delete
 * @returns {Object} 200 - Confirmation of deletion
 * @throws {MedusaError} 400 - Invalid ID format
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social platform not found
 * @throws {MedusaError} 409 - Social platform cannot be deleted (e.g., in use)
 *
 * @example request
 * DELETE /admin/social-platforms/socplat_123456789
 *
 * @example response 200
 * {
 *   "id": "socplat_123456789",
 *   "object": "social_platform",
 *   "deleted": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateSocialPlatform } from "../validators";
import { refetchSocialPlatform } from "../helpers";
import { listSocialPlatformWorkflow } from "../../../../workflows/socials/list-social-platform";
import { updateSocialPlatformWorkflow } from "../../../../workflows/socials/update-social-platform";
import { deleteSocialPlatformWorkflow } from "../../../../workflows/socials/delete-social-platform";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listSocialPlatformWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ socialPlatform: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateSocialPlatform>, res: MedusaResponse) => {
  const { result } = await updateSocialPlatformWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });
  const socialPlatform = await refetchSocialPlatform(result.id, req.scope);
  res.status(200).json({ socialPlatform });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteSocialPlatformWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "social_platform",
    deleted: true,
  });
};
