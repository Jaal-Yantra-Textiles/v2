/**
 * @file Admin API routes for managing social media accounts
 * @description Provides endpoints for retrieving managed Facebook Pages and linked Instagram Business accounts
 * @module API/Admin/Socials
 */

/**
 * @typedef {Object} GetAccountsRequest
 * @property {string} userAccessToken - User access token for authentication with social media platforms
 */

/**
 * @typedef {Object} ManagedAccount
 * @property {string} id - The unique identifier of the account
 * @property {string} name - The name of the account
 * @property {string} type - The type of account (e.g., "page", "instagram_business")
 * @property {string} access_token - The access token for the account
 */

/**
 * @typedef {Object} GetAccountsResponse
 * @property {boolean} success - Indicates if the request was successful
 * @property {ManagedAccount[]} accounts - List of managed accounts
 */

/**
 * Get managed Facebook Pages and linked Instagram Business accounts
 * @route GET /admin/socials/accounts
 * @group Socials - Operations related to social media accounts
 * @param {string} userAccessToken.query.required - User access token for authentication
 * @returns {GetAccountsResponse} 200 - List of managed accounts
 * @throws {MedusaError} 400 - Invalid input data
 * @throws {MedusaError} 401 - Unauthorized
 * @throws {MedusaError} 500 - Internal server error
 *
 * @example request
 * GET /admin/socials/accounts?userAccessToken=EAACEdEose0cBA...
 *
 * @example response 200
 * {
 *   "success": true,
 *   "accounts": [
 *     {
 *       "id": "1234567890123456",
 *       "name": "My Business Page",
 *       "type": "page",
 *       "access_token": "EAACEdEose0cBA..."
 *     },
 *     {
 *       "id": "17841405822334218",
 *       "name": "mybusiness",
 *       "type": "instagram_business",
 *       "access_token": "IGQVJ..."
 *     }
 *   ]
 * }
 */
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/utils"
import { SOCIAL_PROVIDER_MODULE } from "../../../../modules/social-provider"
import SocialProviderService from "../../../../modules/social-provider/service"
import type { GetAccountsRequest } from "./validators"

/**
 * GET /admin/socials/accounts
 * 
 * Get managed Facebook Pages and linked Instagram Business accounts
 * 
 * Query parameters:
 * - userAccessToken: User access token (required)
 * 
 * Note: Query parameter validation is handled by middleware
 */
export const GET = async (
  req: MedusaRequest<GetAccountsRequest>,
  res: MedusaResponse
) => {
  // Query is already validated by middleware
  const { userAccessToken } = req.validatedQuery as GetAccountsRequest

  try {
    const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
    const publisher = socialProvider.getContentPublisher()

    const accounts = await publisher.getManagedAccounts(userAccessToken)

    res.status(200).json({
      success: true,
      ...accounts,
    })
  } catch (error) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Failed to fetch managed accounts: ${error.message}`
    )
  }
}
