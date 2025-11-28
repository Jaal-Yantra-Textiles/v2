import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SOCIAL_PROVIDER_MODULE } from "../../../modules/social-provider"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import SocialProviderService from "../../../modules/social-provider/service"
import InstagramService from "../../../modules/social-provider/instagram-service"
import { TokenData } from "./exchange-oauth-code"

export type FetchPlatformMetadataInput = {
  platform: string
  access_token: string
  token_data: TokenData
}

export type PlatformMetadata = {
  pages?: any[]
  ig_accounts?: any[]
  user_profile?: any
  page_access_token?: string
  user_access_token?: string
  selected_page_id?: string
  error?: string
}

export const fetchPlatformMetadataStep = createStep(
  "fetch-platform-metadata-step",
  async (input: FetchPlatformMetadataInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    const platformLower = input.platform.toLowerCase()
    
    logger.info(`[Fetch Platform Metadata] Platform: ${input.platform}`)

    const metadata: PlatformMetadata = {}

    // Facebook: Fetch managed pages and Instagram accounts
    if (platformLower === "facebook") {
      try {
        const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
        const fb = socialProvider.getProvider("facebook") as any
        const userAccessToken = input.access_token
        
        // Fetch managed pages with fields
        const fields = ["id", "about", "category", "global_brand_page_name", "name", "access_token"]
        const pages = await fb.listManagedPagesWithFields(userAccessToken, fields)
        
        // Fetch linked Instagram business accounts
        const ig = new InstagramService()
        const igAccounts = await ig.getLinkedIgAccounts(userAccessToken)
        
        metadata.pages = pages
        metadata.ig_accounts = igAccounts
        metadata.user_access_token = userAccessToken
        
        logger.info(`[Fetch Platform Metadata] Fetched ${pages.length} Facebook pages and ${igAccounts.length} Instagram accounts`)
        
        // Get Page Access Token for the first page
        if (pages.length > 0) {
          const selectedPageId = pages[0].id
          metadata.selected_page_id = selectedPageId
          
          try {
            const pageAccessToken = await fb.getPageAccessToken(selectedPageId, userAccessToken)
            metadata.page_access_token = pageAccessToken
            
            logger.info(`[Fetch Platform Metadata] ✓ Got Page Access Token for page ${selectedPageId}`)
          } catch (error: any) {
            logger.error(`[Fetch Platform Metadata] Failed to get page access token: ${error.message}`)
            metadata.page_access_token = userAccessToken // Fallback
          }
        } else {
          logger.warn("[Fetch Platform Metadata] No pages found! Using user token as fallback")
          metadata.page_access_token = userAccessToken
        }
        
        if (igAccounts.length === 0) {
          logger.warn("[Fetch Platform Metadata] No Instagram accounts found. Check if Instagram Business account is linked to Facebook Page")
        }
      } catch (error: any) {
        logger.error(`[Fetch Platform Metadata] Failed to fetch Facebook metadata: ${error.message}`)
        metadata.error = error.message
        metadata.pages = []
        metadata.ig_accounts = []
        metadata.page_access_token = input.access_token // Fallback
      }
    }
    
    // Twitter/X: User profile already fetched in exchange step
    if ((platformLower === "twitter" || platformLower === "x") && input.token_data.user_profile) {
      metadata.user_profile = input.token_data.user_profile
      logger.info(`[Fetch Platform Metadata] Twitter user profile: @${input.token_data.user_profile.username}`)
    }

    return new StepResponse(metadata)
  }
)
