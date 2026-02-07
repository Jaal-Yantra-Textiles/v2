/**
 * @file Admin API routes for managing social platforms
 * @description Provides endpoints for creating and listing social platforms in the JYT Commerce platform
 * @module API/Admin/SocialPlatforms
 */

/**
 * @typedef {Object} SocialPlatformInput
 * @property {string} name - The name of the social platform
 * @property {string} category - The category of the social platform
 * @property {string} status - The status of the social platform (active/inactive)
 * @property {string} [description] - Optional description of the social platform
 * @property {string} [icon_url] - Optional URL to the platform's icon
 * @property {string} [auth_url] - Optional authentication URL for the platform
 */

/**
 * @typedef {Object} SocialPlatformResponse
 * @property {string} id - The unique identifier for the social platform
 * @property {string} name - The name of the social platform
 * @property {string} category - The category of the social platform
 * @property {string} status - The status of the social platform
 * @property {string} description - Description of the social platform
 * @property {string} icon_url - URL to the platform's icon
 * @property {string} auth_url - Authentication URL for the platform
 * @property {Date} created_at - When the social platform was created
 * @property {Date} updated_at - When the social platform was last updated
 */

/**
 * @typedef {Object} ListSocialPlatformsResponse
 * @property {SocialPlatformResponse[]} socialPlatforms - Array of social platform objects
 * @property {number} count - Total count of social platforms matching the filters
 */

/**
 * List social platforms with optional filtering and pagination
 * @route GET /admin/social-platforms
 * @group SocialPlatform - Operations related to social platforms
 * @param {string} [q] - Search query to filter by platform name
 * @param {string} [category] - Filter by platform category
 * @param {string} [status] - Filter by platform status (active/inactive)
 * @param {number} [limit=10] - Number of items to return (default: 10)
 * @param {number} [offset=0] - Pagination offset (default: 0)
 * @returns {ListSocialPlatformsResponse} 200 - Paginated list of social platforms
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * GET /admin/social-platforms?q=facebook&category=social&status=active&limit=5&offset=0
 *
 * @example response 200
 * {
 *   "socialPlatforms": [
 *     {
 *       "id": "soc_123456789",
 *       "name": "Facebook",
 *       "category": "social",
 *       "status": "active",
 *       "description": "Connect with friends and the world around you",
 *       "icon_url": "https://example.com/icons/facebook.png",
 *       "auth_url": "https://facebook.com/auth",
 *       "created_at": "2023-01-01T00:00:00Z",
 *       "updated_at": "2023-01-01T00:00:00Z"
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a new social platform
 * @route POST /admin/social-platforms
 * @group SocialPlatform - Operations related to social platforms
 * @param {SocialPlatformInput} request.body.required - Social platform data to create
 * @returns {Object} 201 - Created social platform object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 *
 * @example request
 * POST /admin/social-platforms
 * {
 *   "name": "Twitter",
 *   "category": "social",
 *   "status": "active",
 *   "description": "What's happening?",
 *   "icon_url": "https://example.com/icons/twitter.png",
 *   "auth_url": "https://twitter.com/auth"
 * }
 *
 * @example response 201
 * {
 *   "socialPlatform": {
 *     "id": "soc_987654321",
 *     "name": "Twitter",
 *     "category": "social",
 *     "status": "active",
 *     "description": "What's happening?",
 *     "icon_url": "https://example.com/icons/twitter.png",
 *     "auth_url": "https://twitter.com/auth",
 *     "created_at": "2023-01-01T00:00:00Z",
 *     "updated_at": "2023-01-01T00:00:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { SocialPlatform } from "./validators";
import { refetchSocialPlatform } from "./helpers";
import { createSocialPlatformWorkflow } from "../../../workflows/socials/create-social-platform";
import { listSocialPlatformWorkflow } from "../../../workflows/socials/list-social-platform";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const filters: Record<string, any> = {}
  
  // Add search filter
  if (req.validatedQuery.q) {
    filters.name = req.validatedQuery.q
  }
  
  // Add category filter
  if (req.validatedQuery.category) {
    filters.category = req.validatedQuery.category
  }
  
  // Add status filter
  if (req.validatedQuery.status) {
    filters.status = req.validatedQuery.status
  }
  
  const { result } = await listSocialPlatformWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        take: req.validatedQuery.limit,
        skip: req.validatedQuery.offset,
      },
    },
  });
  res.status(200).json({ socialPlatforms: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<SocialPlatform>, res: MedusaResponse) => {
  const { result } = await createSocialPlatformWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  const socialPlatform = await refetchSocialPlatform(result.id, req.scope);
  res.status(201).json({ socialPlatform });
};
