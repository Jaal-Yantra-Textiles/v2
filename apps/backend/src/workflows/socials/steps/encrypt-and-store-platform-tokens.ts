import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { SOCIALS_MODULE } from "../../../modules/socials"
import { ETSYSYNC_MODULE } from "../../../modules/etsysync"
import { ENCRYPTION_MODULE } from "../../../modules/encryption"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import SocialsService from "../../../modules/socials/service"
import EtsysyncService from "../../../modules/etsysync/service"
import EncryptionService from "../../../modules/encryption/service"
import type { Logger } from "@medusajs/types"
import { TokenData } from "./exchange-oauth-code"
import { PlatformMetadata } from "./fetch-platform-metadata"
import { SOCIAL_PROVIDER_MODULE } from "../../../modules/social-provider"

export type EncryptAndStorePlatformTokensInput = {
  platform_id: string
  platform: string
  token_data: TokenData
  metadata?: PlatformMetadata
}

export const encryptAndStorePlatformTokensStep = createStep(
  "encrypt-and-store-platform-tokens-step",
  async (input: EncryptAndStorePlatformTokensInput, { container }): Promise<StepResponse<any>> => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER) as Logger
    const encryptionService = container.resolve(ENCRYPTION_MODULE) as EncryptionService
    const platformLower = input.platform.toLowerCase()
    
    logger.info(`[Encrypt and Store Tokens] Platform: ${input.platform}, ID: ${input.platform_id}`)

    // Check if this is an external store platform
    const externalStorePlatforms = ["etsy", "shopify", "amazon"]
    
    if (externalStorePlatforms.includes(platformLower)) {
      // Handle external store token storage
      const etsysyncService = container.resolve(ETSYSYNC_MODULE) as EtsysyncService
      
      // Fetch shop info (platform-specific)
      const socialProvider = container.resolve(SOCIAL_PROVIDER_MODULE) as any
      const provider = socialProvider.getProvider(platformLower)
      const shopInfo = await provider.getShopInfo(input.token_data.access_token)
      
      // Calculate token expiration
      const expiresAt = input.token_data.expires_in 
        ? new Date(Date.now() + input.token_data.expires_in * 1000)
        : null
      
      // Encrypt tokens
      const accessTokenEncrypted = encryptionService.encrypt(input.token_data.access_token)
      const refreshTokenEncrypted = input.token_data.refresh_token 
        ? encryptionService.encrypt(input.token_data.refresh_token)
        : null
      
      logger.info(`[Encrypt and Store Tokens] ✓ External store tokens encrypted`)
      
      // Update etsy_account record
      const updated = await etsysyncService.updateEtsy_accounts({
        selector: { id: input.platform_id },
        data: {
          shop_id: shopInfo.shop_id,
          shop_name: shopInfo.shop_name,
          access_token: input.token_data.access_token, // Keep for backward compatibility
          refresh_token: input.token_data.refresh_token || null,
          token_expires_at: expiresAt,
          api_config: {
            access_token_encrypted: accessTokenEncrypted,
            refresh_token_encrypted: refreshTokenEncrypted,
            token_type: input.token_data.token_type,
            scope: input.token_data.scope,
            retrieved_at: new Date(input.token_data.retrieved_at || Date.now()),
            shop_info: shopInfo,
          },
          is_active: true,
        },
      } as any)
      
      logger.info(`[Encrypt and Store Tokens] ✓ External store account updated: ${shopInfo.shop_name}`)
      
      return new StepResponse(updated)
    }

    // Handle social platform token storage
    const socialsService = container.resolve(SOCIALS_MODULE) as SocialsService
    
    // Determine final access token (use page token for Facebook if available)
    const finalAccessToken = input.metadata?.page_access_token || input.token_data.access_token
    
    // Encrypt all sensitive tokens
    const accessTokenEncrypted = encryptionService.encrypt(finalAccessToken)
    const refreshTokenEncrypted = input.token_data.refresh_token 
      ? encryptionService.encrypt(input.token_data.refresh_token)
      : null
    const pageAccessTokenEncrypted = input.metadata?.page_access_token 
      ? encryptionService.encrypt(input.metadata.page_access_token)
      : null
    const userAccessTokenEncrypted = platformLower === "facebook" && input.metadata?.user_access_token
      ? encryptionService.encrypt(input.metadata.user_access_token)
      : null
    
    logger.info(`[Encrypt and Store Tokens] ✓ Social platform tokens encrypted`)
    
    // Build final metadata
    const finalMetadata = {
      ...(input.metadata?.pages ? { pages: input.metadata.pages } : {}),
      ...(input.metadata?.ig_accounts ? { ig_accounts: input.metadata.ig_accounts } : {}),
      ...(input.metadata?.user_profile ? { user_profile: input.metadata.user_profile } : {}),
      ...(input.metadata?.error ? { error: input.metadata.error } : {}),
    }
    
    // Determine provider key
    const providerKey = input.metadata?.selected_page_id 
      || input.metadata?.user_profile?.username 
      || "default"
    
    // Update social platform record
    const updated = await socialsService.updateSocialPlatforms({
      selector: { id: input.platform_id },
      data: {
        api_config: {
          provider: input.platform,
          provider_key: providerKey,
          
          // Encrypted tokens (secure storage)
          access_token_encrypted: accessTokenEncrypted,
          refresh_token_encrypted: refreshTokenEncrypted,
          page_access_token_encrypted: pageAccessTokenEncrypted,
          user_access_token_encrypted: userAccessTokenEncrypted,
          
          // Keep plaintext tokens for backward compatibility (will be removed in future)
          access_token: finalAccessToken,
          page_access_token: input.metadata?.page_access_token,
          user_access_token: platformLower === "facebook" ? input.metadata?.user_access_token : undefined,
          refresh_token: input.token_data.refresh_token,
          
          // Non-sensitive data
          page_id: input.metadata?.selected_page_id,
          token_type: input.metadata?.page_access_token ? "PAGE" : input.token_data.token_type,
          scope: input.token_data.scope,
          expires_in: input.token_data.expires_in,
          retrieved_at: new Date(input.token_data.retrieved_at || Date.now()),
          metadata: finalMetadata,
        },
      },
    })
    
    logger.info(`[Encrypt and Store Tokens] ✓ Social platform updated: ${input.platform}`)
    
    return new StepResponse(updated?.[0])
  }
)
