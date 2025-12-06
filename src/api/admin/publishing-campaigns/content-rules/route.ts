import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { DEFAULT_CONTENT_RULES } from "../../../../modules/socials/types/publishing-automation"

/**
 * GET /admin/publishing-campaigns/content-rules
 * Get available content rule templates
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { platform } = req.query as { platform?: string }
  
  if (platform) {
    const normalizedPlatform = platform.toLowerCase()
    const rule = DEFAULT_CONTENT_RULES[normalizedPlatform]
    
    if (!rule) {
      return res.status(404).json({ 
        error: `No default rule for platform: ${platform}`,
        available_platforms: Object.keys(DEFAULT_CONTENT_RULES),
      })
    }
    
    return res.json({ rule })
  }
  
  return res.json({ 
    rules: DEFAULT_CONTENT_RULES,
    available_platforms: Object.keys(DEFAULT_CONTENT_RULES),
  })
}
