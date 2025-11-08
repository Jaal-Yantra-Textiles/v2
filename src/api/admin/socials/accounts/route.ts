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
