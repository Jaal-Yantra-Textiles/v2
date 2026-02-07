/**
 * @file Admin API routes for managing social posts
 * @description Provides endpoints for retrieving, updating, and deleting social posts in the JYT Commerce platform
 * @module API/Admin/SocialPosts
 */

/**
 * @typedef {Object} UpdateSocialPostInput
 * @property {string} [title] - The title of the social post
 * @property {string} [content] - The content of the social post
 * @property {string} [status] - The status of the social post (e.g., "draft", "published", "archived")
 * @property {string} [platform] - The social media platform (e.g., "facebook", "instagram", "twitter")
 * @property {string} [scheduled_at] - The scheduled publication time in ISO format
 * @property {Object} [metadata] - Additional metadata for the social post
 */

/**
 * @typedef {Object} SocialPostResponse
 * @property {string} id - The unique identifier of the social post
 * @property {string} title - The title of the social post
 * @property {string} content - The content of the social post
 * @property {string} status - The status of the social post
 * @property {string} platform - The social media platform
 * @property {string} scheduled_at - The scheduled publication time in ISO format
 * @property {Date} created_at - When the social post was created
 * @property {Date} updated_at - When the social post was last updated
 * @property {Object} metadata - Additional metadata for the social post
 */

/**
 * Retrieve a social post by ID
 * @route GET /admin/social-posts/:id
 * @group SocialPost - Operations related to social posts
 * @param {string} id.path.required - The ID of the social post to retrieve
 * @returns {Object} 200 - The requested social post object
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social post not found
 *
 * @example request
 * GET /admin/social-posts/web_123456789
 *
 * @example response 200
 * {
 *   "socialPost": {
 *     "id": "web_123456789",
 *     "title": "Summer Sale Announcement",
 *     "content": "Check out our summer sale with up to 50% off!",
 *     "status": "published",
 *     "platform": "facebook",
 *     "scheduled_at": "2023-06-15T10:00:00Z",
 *     "created_at": "2023-06-01T08:00:00Z",
 *     "updated_at": "2023-06-01T08:00:00Z",
 *     "metadata": {}
 *   }
 * }
 */

/**
 * Update a social post by ID
 * @route POST /admin/social-posts/:id
 * @group SocialPost - Operations related to social posts
 * @param {string} id.path.required - The ID of the social post to update
 * @param {UpdateSocialPostInput} request.body.required - Social post data to update
 * @returns {Object} 200 - The updated social post object
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social post not found
 *
 * @example request
 * POST /admin/social-posts/web_123456789
 * {
 *   "title": "Updated Summer Sale Announcement",
 *   "content": "Check out our summer sale with up to 60% off!",
 *   "status": "published",
 *   "platform": "facebook",
 *   "scheduled_at": "2023-06-15T10:00:00Z",
 *   "metadata": {
 *     "campaign": "summer_sale_2023"
 *   }
 * }
 *
 * @example response 200
 * {
 *   "socialPost": {
 *     "id": "web_123456789",
 *     "title": "Updated Summer Sale Announcement",
 *     "content": "Check out our summer sale with up to 60% off!",
 *     "status": "published",
 *     "platform": "facebook",
 *     "scheduled_at": "2023-06-15T10:00:00Z",
 *     "created_at": "2023-06-01T08:00:00Z",
 *     "updated_at": "2023-06-10T09:00:00Z",
 *     "metadata": {
 *       "campaign": "summer_sale_2023"
 *     }
 *   }
 * }
 */

/**
 * Delete a social post by ID
 * @route DELETE /admin/social-posts/:id
 * @group SocialPost - Operations related to social posts
 * @param {string} id.path.required - The ID of the social post to delete
 * @returns {Object} 200 - Confirmation of deletion
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 404 - Social post not found
 *
 * @example request
 * DELETE /admin/social-posts/web_123456789
 *
 * @example response 200
 * {
 *   "id": "web_123456789",
 *   "object": "social_post",
 *   "deleted": true
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { UpdateSocialPost } from "../validators";
import { refetchSocialPost } from "../helpers";
import { listSocialPostWorkflow } from "../../../../workflows/socials/list-social-post";
import { updateSocialPostWorkflow } from "../../../../workflows/socials/update-social-post";
import { deleteSocialPostWorkflow } from "../../../../workflows/socials/delete-social-post";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { result } = await listSocialPostWorkflow(req.scope).run({
    input: { filters: { id: [req.params.id] } },
  });
  res.status(200).json({ socialPost: result[0][0] });
};

export const POST = async (req: MedusaRequest<UpdateSocialPost>, res: MedusaResponse) => {
  const { result } = await updateSocialPostWorkflow(req.scope).run({
    input: {
      id: req.params.id,
      ...req.validatedBody,
    },
  });

  const socialPost = await refetchSocialPost(result[0].id, req.scope);
  res.status(200).json({ socialPost });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  await deleteSocialPostWorkflow(req.scope).run({
    input: { id: req.params.id },
  });
  res.status(200).json({
    id: req.params.id,
    object: "social_post",
    deleted: true,
  });
};
