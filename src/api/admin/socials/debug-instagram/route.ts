import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import SocialsService from "../../../../modules/socials/service"
import InstagramService from "../../../../modules/social-provider/instagram-service"

/**
 * GET /admin/socials/debug-instagram?platform_id=xxx
 * 
 * Debug endpoint to check Instagram account linking
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const platformId = req.query.platform_id as string | undefined

  if (!platformId) {
    return res.status(400).json({ 
      error: "Missing platform_id query parameter" 
    })
  }

  try {
    const socials = req.scope.resolve(SOCIALS_MODULE) as SocialsService

    // Load the platform
    const [platform] = await socials.listSocialPlatforms({ id: platformId })

    if (!platform) {
      return res.status(404).json({ 
        error: `Platform ${platformId} not found` 
      })
    }

    const apiConfig = (platform.api_config || {}) as Record<string, any>
    const accessToken = apiConfig.access_token as string | undefined

    if (!accessToken) {
      return res.status(400).json({ 
        error: "No access token found in platform configuration" 
      })
    }

    // Test the Instagram API call
    const ig = new InstagramService()
    
    // First, let's check what the raw API returns
    const url = new URL("https://graph.facebook.com/v24.0/me/accounts")
    url.searchParams.set("fields", "id,name,instagram_business_account{id,username}")
    url.searchParams.set("access_token", accessToken)
    
    const resp = await fetch(url.toString())
    const rawData = await resp.json()

    if (!resp.ok) {
      return res.status(500).json({
        error: "Facebook API error",
        status: resp.status,
        response: rawData,
        hint: "Check if your access token has the required permissions: instagram_basic, instagram_content_publish"
      })
    }

    // Now try the service method
    let igAccounts: any[] = []
    let serviceError: string | null = null
    
    try {
      igAccounts = await ig.getLinkedIgAccounts(accessToken)
    } catch (e) {
      serviceError = (e as Error).message
    }

    return res.status(200).json({
      success: true,
      platform: {
        id: platform.id,
        name: (platform as any).name,
      },
      raw_api_response: rawData,
      parsed_ig_accounts: igAccounts,
      service_error: serviceError,
      diagnostics: {
        has_access_token: !!accessToken,
        token_length: accessToken.length,
        pages_count: rawData.data?.length || 0,
        pages_with_ig: rawData.data?.filter((p: any) => p.instagram_business_account).length || 0,
      },
      instructions: {
        no_ig_accounts: "If no Instagram accounts found, ensure:",
        steps: [
          "1. Your Instagram account is a Business or Creator account",
          "2. The Instagram account is linked to your Facebook Page (Settings → Instagram → Connect Account)",
          "3. Your Facebook app has 'instagram_basic' and 'instagram_content_publish' permissions",
          "4. You've granted these permissions during OAuth",
        ]
      }
    })
  } catch (error) {
    return res.status(500).json({
      error: "Debug endpoint failed",
      message: (error as Error).message,
      stack: (error as Error).stack,
    })
  }
}
