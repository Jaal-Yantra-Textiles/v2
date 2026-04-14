import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../../../modules/socials"
import { getWhatsAppConfig, graphApiRequest } from "../../helpers"

/**
 * POST /admin/social-platforms/whatsapp/templates/sync
 *
 * Sync templates from Meta and store in the SocialPlatform api_config.
 * This caches templates locally so the UI doesn't need to hit Meta every time.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const config = await getWhatsAppConfig(req.scope)

  if (!config.accessToken || !config.wabaId) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "WhatsApp or WABA ID not configured")
  }

  // Fetch all templates from Meta (paginated)
  const templates: any[] = []
  let url: string | null = `${config.wabaId}/message_templates?limit=100`

  while (url) {
    const data = await graphApiRequest(url, config.accessToken)
    for (const t of data.data || []) {
      templates.push({
        id: t.id,
        name: t.name,
        status: t.status,
        category: t.category,
        language: t.language,
        components: t.components,
        quality_score: t.quality_score,
      })
    }
    url = data.paging?.next || null
  }

  // Save to SocialPlatform api_config
  if (config.platformId) {
    const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
    const platform = await socialsService.retrieveSocialPlatform(config.platformId)
    const apiConfig = (platform?.api_config as Record<string, any>) || {}

    await socialsService.updateSocialPlatforms({
      selector: { id: config.platformId },
      data: {
        api_config: {
          ...apiConfig,
          templates,
          templates_synced_at: new Date().toISOString(),
        },
      },
    })
  }

  res.json({
    synced: templates.length,
    templates,
  })
}
