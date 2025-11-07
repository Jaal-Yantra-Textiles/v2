import { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { SOCIAL_PROVIDER_MODULE, SocialProviderService } from "../../../../../modules/social-provider"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import InstagramService from "../../../../../modules/social-provider/instagram-service"
import SocialsService from "../../../../../modules/socials/service"

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

  const redirectEnvKey = `${platform.toUpperCase()}_REDIRECT_URI`
  const redirectUri = process.env[redirectEnvKey] ?? ""

  // Resolve provider service and socials service
  const socialProvider = req.scope.resolve(
    SOCIAL_PROVIDER_MODULE
  ) as SocialProviderService
  const socialsService = req.scope.resolve(SOCIALS_MODULE) as SocialsService

  const provider = socialProvider.getProvider(platform.toLowerCase()) as any

  // Exchange code for token (provider-specific signatures)
  let tokenData: any
  if (platform.toLowerCase() === "twitter") {
    // Twitter uses PKCE state to retrieve verifier internally
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
