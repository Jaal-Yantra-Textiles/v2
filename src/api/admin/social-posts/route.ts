/**
 * @file Admin API routes for managing social posts
 * @description Provides endpoints for creating and listing social posts in the JYT Commerce platform
 * @module API/Admin/SocialPosts
 */

/**
 * @typedef {Object} SocialPostInput
 * @property {string} name - The name of the social post
 * @property {string} status - The status of the social post (e.g., "draft", "published", "failed")
 * @property {Date} posted_at - The date and time when the post was published
 * @property {string} error_message - Error message if the post failed
 * @property {string} content - The content of the social post
 * @property {string} platform - The social media platform (e.g., "facebook", "instagram", "twitter")
 */

/**
 * @typedef {Object} SocialPostResponse
 * @property {string} id - The unique identifier of the social post
 * @property {string} name - The name of the social post
 * @property {string} status - The status of the social post
 * @property {Date} posted_at - The date and time when the post was published
 * @property {string} error_message - Error message if the post failed
 * @property {string} content - The content of the social post
 * @property {string} platform - The social media platform
 * @property {Date} created_at - When the social post was created
 * @property {Date} updated_at - When the social post was last updated
 */

/**
 * @typedef {Object} ListSocialPostsResponse
 * @property {SocialPostResponse[]} socialPosts - Array of social posts
 * @property {number} count - Total count of social posts matching the filters
 */

/**
 * List social posts with optional filtering and pagination
 * @route GET /admin/social-posts
 * @group SocialPost - Operations related to social posts
 * @param {string} [q] - Search query to filter by name
 * @param {string} [status] - Filter by status (e.g., "draft", "published", "failed")
 * @param {Date} [posted_at] - Filter by posted date
 * @param {string} [error_message] - Filter by error message
 * @param {number} [limit=10] - Number of items to return
 * @param {number} [offset=0] - Pagination offset
 * @returns {ListSocialPostsResponse} 200 - Paginated list of social posts
 * @throws {MedusaError} 400 - Invalid query parameters
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/social-posts?q=summer&status=published&limit=5&offset=0
 *
 * @example response 200
 * {
 *   "socialPosts": [
 *     {
 *       "id": "spost_123456789",
 *       "name": "Summer Sale",
 *       "status": "published",
 *       "posted_at": "2023-06-15T10:00:00Z",
 *       "error_message": null,
 *       "content": "Check out our summer sale!",
 *       "platform": "instagram",
 *       "created_at": "2023-06-10T14:30:00Z",
 *       "updated_at": "2023-06-15T10:05:00Z"
 *     }
 *   ],
 *   "count": 1
 * }
 */

/**
 * Create a new social post
 * @route POST /admin/social-posts
 * @group SocialPost - Operations related to social posts
 * @param {SocialPostInput} request.body.required - Social post data to create
 * @returns {Object} 201 - Created social post object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * POST /admin/social-posts
 * {
 *   "name": "New Product Launch",
 *   "status": "draft",
 *   "content": "Exciting new product coming soon!",
 *   "platform": "twitter"
 * }
 *
 * @example response 201
 * {
 *   "socialPost": {
 *     "id": "spost_987654321",
 *     "name": "New Product Launch",
 *     "status": "draft",
 *     "posted_at": null,
 *     "error_message": null,
 *     "content": "Exciting new product coming soon!",
 *     "platform": "twitter",
 *     "created_at": "2023-07-01T09:15:00Z",
 *     "updated_at": "2023-07-01T09:15:00Z"
 *   }
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { SocialPost } from "./validators";
import { refetchSocialPost } from "./helpers";
import { createSocialPostWorkflow } from "../../../workflows/socials/create-social-post";
import { listSocialPostWorkflow } from "../../../workflows/socials/list-social-post";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { q, status, posted_at, error_message, limit, offset } = req.validatedQuery;

  const filters: Record<string, any> = {};
  if (q) {
    filters.name = q;
  }
  if (status) {
    filters.status = status;
  }
  if (posted_at) {
    filters.posted_at = posted_at;
  }
  if (error_message) {
    filters.error_message = error_message;
  }

  const { result } = await listSocialPostWorkflow(req.scope).run({
    input: {
      filters,
      config: {
        take: limit,
        skip: offset,
      },
    },
  });
  res.status(200).json({ socialPosts: result[0], count: result[1] });
};

export const POST = async (req: MedusaRequest<SocialPost>, res: MedusaResponse) => {
  console.log(req.validatedBody)
  const { result } = await createSocialPostWorkflow(req.scope).run({
    input: req.validatedBody,
  });
  const socialpost = await refetchSocialPost(result.id, req.scope);
  res.status(201).json({ socialPost: socialpost });
};
