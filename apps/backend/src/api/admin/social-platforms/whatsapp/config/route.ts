import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import { getWhatsAppConfig, graphApiRequest } from "../helpers"

/**
 * GET /admin/social-platforms/whatsapp/config
 *
 * Returns the current WhatsApp configuration (non-sensitive fields).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = (req.query.platform_id as string | undefined) || undefined
  const config = await getWhatsAppConfig(req.scope, platformId)

  // Get phone number info from Meta if possible
  let phoneInfo: any = null
  if (config.accessToken && config.phoneNumberId) {
    try {
      phoneInfo = await graphApiRequest(
        `${config.phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,account_mode`,
        config.accessToken
      )
    } catch { /* non-fatal */ }
  }

  // Get WABA info
  let wabaInfo: any = null
  if (config.accessToken && config.wabaId) {
    try {
      wabaInfo = await graphApiRequest(
        `${config.wabaId}?fields=id,name,currency,timezone_id,message_template_namespace`,
        config.accessToken
      )
    } catch { /* non-fatal */ }
  }

  // Get cached templates count from platform
  let templateCount = 0
  let initiationTemplate: string | null = null
  let initiationTemplateLang: string | null = null
  if (config.platformId) {
    try {
      const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
      const platform = await socialsService.retrieveSocialPlatform(config.platformId)
      const apiConfig = platform?.api_config as Record<string, any>
      templateCount = apiConfig?.templates?.length || 0
      initiationTemplate = apiConfig?.initiation_template || null
      initiationTemplateLang = apiConfig?.initiation_template_lang || null
    } catch { /* non-fatal */ }
  }

  res.json({
    configured: !!config.accessToken,
    source: config.platformId ? "database" : "env",
    platform_id: config.platformId || null,
    phone_number_id: config.phoneNumberId || null,
    waba_id: config.wabaId || null,
    phone_info: phoneInfo,
    waba_info: wabaInfo,
    has_access_token: !!config.accessToken,
    template_count: templateCount,
    initiation_template: initiationTemplate || process.env.WHATSAPP_INITIATION_TEMPLATE || null,
    initiation_template_lang: initiationTemplateLang || process.env.WHATSAPP_INITIATION_TEMPLATE_LANG || null,
  })
}

/**
 * POST /admin/social-platforms/whatsapp/config
 *
 * Update WhatsApp configuration: WABA ID, default template, etc.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { waba_id, initiation_template, initiation_template_lang } = req.body as {
    waba_id?: string
    initiation_template?: string
    initiation_template_lang?: string
  }

  const platformId = (req.query.platform_id as string | undefined) || undefined
  const config = await getWhatsAppConfig(req.scope, platformId)

  if (!config.platformId) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "WhatsApp not connected via SocialPlatform. Add one in Settings > External Platforms."
    )
  }

  const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
  const platform = await socialsService.retrieveSocialPlatform(config.platformId)
  const apiConfig = (platform?.api_config as Record<string, any>) || {}

  const updates: Record<string, any> = { ...apiConfig }
  if (waba_id !== undefined) updates.waba_id = waba_id
  if (initiation_template !== undefined) updates.initiation_template = initiation_template
  if (initiation_template_lang !== undefined) updates.initiation_template_lang = initiation_template_lang

  await socialsService.updateSocialPlatforms({
    selector: { id: config.platformId },
    data: { api_config: updates },
  })

  res.json({
    success: true,
    waba_id: updates.waba_id,
    initiation_template: updates.initiation_template,
    initiation_template_lang: updates.initiation_template_lang,
  })
}
