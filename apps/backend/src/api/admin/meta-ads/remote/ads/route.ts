/**
 * @file Admin API routes for Meta Ads remote management
 * @description Provides endpoints for creating and managing Meta ads in the JYT Commerce platform
 * @module API/Admin/MetaAds
 */

/**
 * @typedef {Object} MetaAdInput
 * @property {string} name - The name of the Meta ad
 * @property {string} campaign_id - The ID of the campaign this ad belongs to
 * @property {string} ad_set_id - The ID of the ad set this ad belongs to
 * @property {string} creative_id - The ID of the creative used in this ad
 * @property {string} status - The status of the ad (ACTIVE, PAUSED, DELETED, ARCHIVED)
 * @property {Object} targeting - The targeting criteria for the ad
 * @property {string} targeting.age_min - Minimum age for targeting
 * @property {string} targeting.age_max - Maximum age for targeting
 * @property {string[]} targeting.genders - Array of gender targets (1 for male, 2 for female)
 * @property {string[]} targeting.locations - Array of location IDs to target
 * @property {string} bid_amount - The bid amount for the ad
 * @property {string} billing_event - The billing event (IMPRESSIONS, LINK_CLICKS, etc.)
 * @property {string} optimization_goal - The optimization goal for the ad
 * @property {string} [start_time] - Optional start time for the ad in ISO format
 * @property {string} [end_time] - Optional end time for the ad in ISO format
 */

/**
 * @typedef {Object} MetaAdResponse
 * @property {string} id - The unique identifier for the Meta ad
 * @property {string} name - The name of the Meta ad
 * @property {string} campaign_id - The ID of the campaign this ad belongs to
 * @property {string} ad_set_id - The ID of the ad set this ad belongs to
 * @property {string} creative_id - The ID of the creative used in this ad
 * @property {string} status - The status of the ad
 * @property {Object} targeting - The targeting criteria for the ad
 * @property {string} bid_amount - The bid amount for the ad
 * @property {string} billing_event - The billing event
 * @property {string} optimization_goal - The optimization goal for the ad
 * @property {string} created_at - When the ad was created in ISO format
 * @property {string} updated_at - When the ad was last updated in ISO format
 * @property {string} [start_time] - Optional start time for the ad
 * @property {string} [end_time] - Optional end time for the ad
 */

/**
 * Create a new Meta ad (Placeholder - Not implemented)
 * @route POST /admin/meta-ads/remote/ads
 * @group MetaAds - Operations related to Meta ads management
 * @param {MetaAdInput} request.body.required - Meta ad data to create
 * @returns {MetaAdResponse} 201 - Created Meta ad object (when implemented)
 * @throws {MedusaError} 405 - Method not allowed (current implementation)
 * @throws {MedusaError} 400 - Invalid input data (future implementation)
 * @throws {MedusaError} 401 - Unauthorized (future implementation)
 * @throws {MedusaError} 403 - Forbidden (future implementation)
 * @throws {MedusaError} 500 - Internal server error (future implementation)
 *
 * @example request
 * POST /admin/meta-ads/remote/ads
 * {
 *   "name": "Summer Sale Campaign",
 *   "campaign_id": "23843456789012345",
 *   "ad_set_id": "23843456789012346",
 *   "creative_id": "23843456789012347",
 *   "status": "ACTIVE",
 *   "targeting": {
 *     "age_min": "18",
 *     "age_max": "65",
 *     "genders": ["1", "2"],
 *     "locations": ["2345678", "1234567"]
 *   },
 *   "bid_amount": "5",
 *   "billing_event": "LINK_CLICKS",
 *   "optimization_goal": "LINK_CLICKS",
 *   "start_time": "2023-06-01T00:00:00Z",
 *   "end_time": "2023-06-30T23:59:59Z"
 * }
 *
 * @example response 201 (Future implementation)
 * {
 *   "ad": {
 *     "id": "23843456789012348",
 *     "name": "Summer Sale Campaign",
 *     "campaign_id": "23843456789012345",
 *     "ad_set_id": "23843456789012346",
 *     "creative_id": "23843456789012347",
 *     "status": "ACTIVE",
 *     "targeting": {
 *       "age_min": "18",
 *       "age_max": "65",
 *       "genders": ["1", "2"],
 *       "locations": ["2345678", "1234567"]
 *     },
 *     "bid_amount": "5",
 *     "billing_event": "LINK_CLICKS",
 *     "optimization_goal": "LINK_CLICKS",
 *     "created_at": "2023-05-15T10:30:00Z",
 *     "updated_at": "2023-05-15T10:30:00Z",
 *     "start_time": "2023-06-01T00:00:00Z",
 *     "end_time": "2023-06-30T23:59:59Z"
 *   }
 * }
 *
 * @example response 405 (Current implementation)
 * {
 *   "message": "Remote ad creation is not implemented yet",
 *   "code": "not_allowed",
 *   "type": "not_allowed"
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * POST /admin/meta-ads/remote/ads
 *
 * Placeholder endpoint for future: create Meta ads using custom data.
 *
 * Not implemented yet by design.
 */
export const POST = async (_req: MedusaRequest, _res: MedusaResponse) => {
  throw new MedusaError(
    MedusaError.Types.NOT_ALLOWED,
    "Remote ad creation is not implemented yet"
  )
}
