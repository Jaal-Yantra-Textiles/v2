import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SOCIAL_PROVIDER_MODULE, SocialProviderService } from "../../../../../modules/social-provider"
import { EXTERNAL_STORES_MODULE, ExternalStoresService } from "../../../../../modules/external_stores"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import { ETSYSYNC_MODULE } from "../../../../../modules/etsysync"
import InstagramService from "../../../../../modules/social-provider/instagram-service"
import SocialsService from "../../../../../modules/socials/service"
import EtsysyncService from "../../../../../modules/etsysync/service"

interface CallbackRequestBody {
  id: string
  code: string
  state?: string
}

export const POST = async (
  req: MedusaRequest<CallbackRequestBody>,
  res: MedusaResponse
) => {
  const { platform } = req.params as { platform: string }
  const { id, code, state } = req.body || ({} as CallbackRequestBody)

  if (!id || !code) {
    res.status(400).json({ message: "Missing id or code in request body" })
    return
  }

  const platformLower = platform.toLowerCase()
  
  // Check if this is an external store platform
  const externalStorePlatforms = ["etsy", "shopify", "amazon"]
  if (externalStorePlatforms.includes(platformLower)) {
    // Handle external store OAuth callback
    const externalStores = req.scope.resolve(EXTERNAL_STORES_MODULE) as ExternalStoresService
    const etsysyncService = req.scope.resolve(ETSYSYNC_MODULE) as EtsysyncService
    
    const provider = externalStores.getProvider(platformLower)
    
    // Get redirect URI from environment
    const redirectEnvKey = `${platformLower.toUpperCase()}_REDIRECT_URI`
    const redirectUri = process.env[redirectEnvKey] ?? ""
    
    try {
      // Exchange code for token
      const tokenData = await provider.exchangeCodeForToken(code, redirectUri)
      
      // Fetch shop info
      const shopInfo = await provider.getShopInfo(tokenData.access_token)
      
      // Calculate token expiration
      const expiresAt = tokenData.expires_in 
        ? new Date(Date.now() + tokenData.expires_in * 1000)
        : null
      
      // Update etsy_account record
      const updated = await etsysyncService.updateEtsy_accounts({
        selector: { id },
        data: {
          shop_id: shopInfo.shop_id,
          shop_name: shopInfo.shop_name,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || null,
          token_expires_at: expiresAt,
          api_config: {
            token_type: tokenData.token_type,
            scope: tokenData.scope,
            retrieved_at: new Date(tokenData.retrieved_at || Date.now()),
            shop_info: shopInfo,
          },
          is_active: true,
        },
      } as any)
      
      res.status(200).json({ 
        success: true,
        account: updated,
        shop_info: shopInfo,
      })
    } catch (error: any) {
      console.error(`[OAuth Callback] Failed to process ${platform} callback:`, error.message)
      res.status(500).json({ message: error.message })
    }
    
    return
  }

  // Handle social platform OAuth callback (existing logic)
  // Normalize "x" to "twitter" for environment variable lookups
  const envPlatform = platformLower === "x" ? "twitter" : platform
  const redirectEnvKey = `${envPlatform.toUpperCase()}_REDIRECT_URI`
  const redirectUri = process.env[redirectEnvKey] ?? ""

  // Resolve provider service and socials service
  const socialProvider = req.scope.resolve(
    SOCIAL_PROVIDER_MODULE
  ) as SocialProviderService
  const socialsService = req.scope.resolve(SOCIALS_MODULE) as SocialsService

  const provider = socialProvider.getProvider(platformLower) as any

  // Exchange code for token (provider-specific signatures)
  let tokenData: any
  if (platformLower === "twitter" || platformLower === "x") {
    // Twitter/X uses PKCE state to retrieve verifier internally
    tokenData = await provider.exchangeCodeForToken(code, redirectUri, state)
  } else {
    // Facebook/LinkedIn/Instagram commonly: (code, redirectUri)
    tokenData = await provider.exchangeCodeForToken(code, redirectUri)
  }

  // Enrich: if Facebook, fetch managed pages and linked IG accounts to cache in metadata
  let metadata: Record<string, any> | undefined = undefined
  if (platform.toLowerCase() === "facebook") {
    try {
      const fb = provider // FacebookService instance
      const fields = ["id", "about", "category", "global_brand_page_name", "name"]
      const pages = await fb.listManagedPagesWithFields(tokenData.access_token, fields)
      // Also fetch linked IG business accounts via Graph
      const ig = new InstagramService()
      const igAccounts = await ig.getLinkedIgAccounts(tokenData.access_token)
      metadata = { pages, ig_accounts: igAccounts }
      
      // Log for debugging
      console.log(`[OAuth Callback] Fetched ${pages.length} Facebook pages and ${igAccounts.length} Instagram accounts`)
      if (igAccounts.length === 0) {
        console.warn("[OAuth Callback] No Instagram accounts found. Check if Instagram Business account is linked to Facebook Page.")
      }
    } catch (e) {
      // Non-fatal: continue without metadata cache, but log the error
      console.error("[OAuth Callback] Failed to fetch pages/IG accounts:", (e as Error).message)
      metadata = { pages: [], ig_accounts: [], error: (e as Error).message }
    }
  }

  // Persist on the SocialPlatform record under api_config
  const updated = await socialsService.updateSocialPlatforms({
    selector: { id },
    data: {
      api_config: {
        provider,
        provider_key: tokenData.access_token, // adjust if you later fetch a user/page id
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_type: tokenData.token_type,
        scope: tokenData.scope,
        expires_in: tokenData.expires_in,
        retrieved_at: new Date(tokenData.retrieved_at || Date.now()),
        metadata,
      },
    },
  })

  res.status(200).json({ platform: updated?.[0] })
}
