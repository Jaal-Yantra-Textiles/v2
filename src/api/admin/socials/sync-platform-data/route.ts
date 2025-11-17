import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { syncPlatformHashtagsMentionsWorkflow } from "../../../../workflows/socials/sync-platform-hashtags-mentions"
import { SOCIALS_MODULE } from "../../../../modules/socials"

/**
 * POST /admin/socials/sync-platform-data
 * 
 * Sync hashtags and mentions from social platform (Facebook/Instagram)
 * Body:
 * - platform_id: ID of the social platform
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { platform_id } = req.body as { platform_id: string }

  if (!platform_id) {
    return res.status(400).json({ error: "platform_id is required" })
  }

  try {
    // Get platform to extract access token
    const socials = req.scope.resolve(SOCIALS_MODULE)
    
    const [platform] = await socials.listSocialPlatforms({ id: platform_id })
    
    if (!platform) {
      return res.status(404).json({ error: "Platform not found" })
    }

    const accessToken = (platform as any)?.api_config?.access_token
    
    if (!accessToken) {
      return res.status(400).json({ error: "Platform has no access token" })
    }

    // Run sync workflow
    const { result } = await syncPlatformHashtagsMentionsWorkflow(req.scope).run({
      input: {
        platform_id,
        access_token: accessToken,
      },
    })

    res.json({
      message: "Platform data sync completed",
      results: result,
    })
  } catch (error) {
    console.error("Error syncing platform data:", error)
    res.status(500).json({ 
      error: "Failed to sync platform data",
      details: error.message 
    })
  }
}
