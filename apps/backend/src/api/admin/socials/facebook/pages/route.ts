/**
 * @file Admin API routes for Facebook social pages management
 * @description Provides endpoints for publishing posts to Facebook pages and retrieving managed pages
 * @module API/Admin/Socials/Facebook
 * @deprecated This module is deprecated. Use the new social posts API instead.
 */

/**
 * @typedef {Object} PublishByPostIdBody
 * @property {string} post_id - The ID of the social post to publish
 * @property {string} [page_id] - Optional Facebook page ID to publish to
 */

/**
 * @typedef {Object} FacebookPage
 * @property {string} id - The Facebook page ID
 * @property {string} name - The name of the Facebook page
 * @property {string} access_token - The page access token
 */

/**
 * @typedef {Object} PublishResponse
 * @property {Object} post - The published post details
 * @property {string} _deprecated - Deprecation notice
 */

/**
 * @typedef {Object} PagesResponse
 * @property {FacebookPage[]} pages - Array of Facebook pages
 * @property {string} _deprecated - Deprecation notice
 */

/**
 * Publish a social post to Facebook
 * @route POST /admin/socials/facebook/pages
 * @group Socials - Operations related to social media integrations
 * @deprecated Use POST /admin/social-posts/:id/publish instead
 * @param {PublishByPostIdBody} request.body.required - Post publishing data
 * @returns {PublishResponse} 200 - Published post object
 * @throws {MedusaError} 400 - Missing post_id in request body
 * @throws {MedusaError} 500 - Publish workflow failed
 *
 * @example request
 * POST /admin/socials/facebook/pages
 * {
 *   "post_id": "post_123456789",
 *   "page_id": "fb_page_987654321"
 * }
 *
 * @example response 200
 * {
 *   "post": {
 *     "id": "post_123456789",
 *     "status": "published",
 *     "published_at": "2023-01-01T00:00:00Z",
 *     "platform": "facebook",
 *     "page_id": "fb_page_987654321"
 *   },
 *   "_deprecated": "This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead."
 * }
 */

/**
 * List Facebook pages managed by the authenticated user
 * @route GET /admin/socials/facebook/pages
 * @group Socials - Operations related to social media integrations
 * @deprecated Use platform.api_config.metadata.pages from the social platform instead
 * @param {string} platform_id.query.required - The social platform ID
 * @returns {PagesResponse} 200 - Array of Facebook pages
 * @throws {MedusaError} 400 - Missing platform_id or no user access token
 * @throws {MedusaError} 404 - Social platform not found
 *
 * @example request
 * GET /admin/socials/facebook/pages?platform_id=fb_platform_123456789
 *
 * @example response 200
 * {
 *   "pages": [
 *     {
 *       "id": "fb_page_123456789",
 *       "name": "My Business Page",
 *       "access_token": "EAAXYZ123456789"
 *     },
 *     {
 *       "id": "fb_page_987654321",
 *       "name": "My Community Page",
 *       "access_token": "EAAXYZ987654321"
 *     }
 *   ],
 *   "_deprecated": "This endpoint is deprecated. Use platform.api_config.metadata.pages instead."
 * }
 */
import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { publishSocialPostWorkflow } from "../../../../../workflows/socials/publish-post"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import SocialsService from "../../../../../modules/socials/service"
import FacebookService from "../../../../../modules/social-provider/facebook-service"

interface PublishByPostIdBody {
  post_id: string
  page_id?: string
}

/**
 * @deprecated Use POST /admin/social-posts/:id/publish instead
 * This endpoint will be removed in a future version
 */
export const POST = async (
  req: MedusaRequest<PublishByPostIdBody>,
  res: MedusaResponse
) => {
  const { post_id, page_id } = req.body || {}

  if (!post_id) {
    res.status(400).json({ message: "Missing post_id" })
    return
  }

  console.warn(
    "[DEPRECATED] POST /admin/socials/facebook/pages is deprecated. " +
    "Use POST /admin/social-posts/:id/publish instead."
  )

  const { result, errors } = await publishSocialPostWorkflow(req.scope).run({
    input: { post_id, page_id },
  })

  if (errors?.length) {
    res.status(500).json({ message: "Publish workflow failed", errors })
    return
  }

  res.status(200).json({ 
    post: result,
    _deprecated: "This endpoint is deprecated. Use POST /admin/social-posts/:id/publish instead."
  })
}

/**
 * @deprecated This endpoint is no longer used. Facebook pages are cached in 
 * platform.api_config.metadata.pages during OAuth callback. Use that cached data instead.
 * This endpoint will be removed in a future version.
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const platform_id = (req.query?.platform_id as string) || ""
  if (!platform_id) {
    res.status(400).json({ message: "Missing platform_id" })
    return
  }

  console.warn(
    "[DEPRECATED] GET /admin/socials/facebook/pages is deprecated. " +
    "Use platform.api_config.metadata.pages from the social platform instead."
  )

  const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService
  const [platform] = await socials.listSocialPlatforms({ id: platform_id })
  if (!platform) {
    res.status(404).json({ message: `SocialPlatform ${platform_id} not found` })
    return
  }

  // Use user_access_token for listing pages (Page Access Token doesn't have permission)
  const userAccessToken = (platform as any).api_config?.user_access_token as string | undefined
  const fallbackToken = (platform as any).api_config?.access_token as string | undefined
  const token = userAccessToken || fallbackToken
  
  if (!token) {
    res.status(400).json({ message: "No user access token on platform.api_config" })
    return
  }

  const fb = new FacebookService()
  const pages = await fb.listManagedPages(token)
  res.status(200).json({ 
    pages,
    _deprecated: "This endpoint is deprecated. Use platform.api_config.metadata.pages instead."
  })
}