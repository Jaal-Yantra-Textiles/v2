import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

/**
 * Debug Facebook token permissions
 * GET /admin/social-platforms/:id/debug-token
 */
export const GET = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { id } = req.params

  try {
    const socials = req.scope.resolve("socialsModuleService") as any
    
    // Get platform
    const [platform] = await socials.listSocialPlatforms({ id })
    
    if (!platform) {
      return res.status(404).json({ error: "Platform not found" })
    }

    const config = platform.config as Record<string, any>
    const accessToken = config.access_token || config.page_access_token

    if (!accessToken) {
      return res.status(400).json({ error: "No access token found for platform" })
    }

    // Debug token using Facebook's debug_token endpoint
    const debugUrl = `https://graph.facebook.com/v21.0/debug_token?input_token=${accessToken}&access_token=${accessToken}`
    
    const debugResponse = await fetch(debugUrl)
    const debugData = await debugResponse.json()

    if (debugData.error) {
      return res.status(400).json({ 
        error: "Failed to debug token",
        details: debugData.error 
      })
    }

    // Get token info
    const tokenInfo = debugData.data || {}
    
    // Also try to get the user/page info
    let entityInfo = null
    try {
      const meResponse = await fetch(`https://graph.facebook.com/v21.0/me?access_token=${accessToken}`)
      entityInfo = await meResponse.json()
    } catch (error) {
      console.warn("Could not fetch entity info:", error)
    }

    return res.json({
      platform: {
        id: platform.id,
        name: platform.name,
      },
      token_info: {
        app_id: tokenInfo.app_id,
        type: tokenInfo.type, // "USER" or "PAGE"
        application: tokenInfo.application,
        expires_at: tokenInfo.expires_at,
        is_valid: tokenInfo.is_valid,
        issued_at: tokenInfo.issued_at,
        scopes: tokenInfo.scopes || [],
        user_id: tokenInfo.user_id,
        data_access_expires_at: tokenInfo.data_access_expires_at,
      },
      entity_info: entityInfo,
      recommendations: {
        has_pages_read_engagement: tokenInfo.scopes?.includes("pages_read_engagement"),
        has_pages_manage_posts: tokenInfo.scopes?.includes("pages_manage_posts"),
        has_pages_show_list: tokenInfo.scopes?.includes("pages_show_list"),
        token_type: tokenInfo.type,
        needs_reauth: !tokenInfo.is_valid || !tokenInfo.scopes?.includes("pages_manage_posts"),
      }
    })

  } catch (error) {
    console.error("[Debug Token] Error:", error)
    return res.status(500).json({ 
      error: "Failed to debug token",
      message: error.message 
    })
  }
}
