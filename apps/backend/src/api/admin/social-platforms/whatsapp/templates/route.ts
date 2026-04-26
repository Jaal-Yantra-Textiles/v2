import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getWhatsAppConfig, graphApiRequest } from "../helpers"

/**
 * GET /admin/social-platforms/whatsapp/templates
 *
 * List WhatsApp message templates from Meta.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = (req.query.platform_id as string | undefined) || undefined
  const config = await getWhatsAppConfig(req.scope, platformId)

  if (!config.accessToken) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "WhatsApp not configured")
  }

  if (!config.wabaId) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "WABA ID not configured. Set it via /admin/social-platforms/whatsapp/config"
    )
  }

  const limit = Number(req.query.limit) || 50
  const status = req.query.status as string | undefined

  let url = `${config.wabaId}/message_templates?limit=${limit}`
  if (status) url += `&status=${status}`

  const data = await graphApiRequest(url, config.accessToken)

  res.json({
    templates: (data.data || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      category: t.category,
      language: t.language,
      components: t.components,
      quality_score: t.quality_score,
    })),
    paging: data.paging,
  })
}

/**
 * POST /admin/social-platforms/whatsapp/templates
 *
 * Create a new WhatsApp message template on Meta.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const platformId = (req.query.platform_id as string | undefined) || undefined
  const config = await getWhatsAppConfig(req.scope, platformId)

  if (!config.accessToken || !config.wabaId) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "WhatsApp or WABA ID not configured")
  }

  const { name, category, language, components } = req.body as {
    name: string
    category: "UTILITY" | "MARKETING" | "AUTHENTICATION"
    language: string
    components: any[]
  }

  if (!name || !category || !language || !components) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "name, category, language, and components are required")
  }

  const result = await graphApiRequest(
    `${config.wabaId}/message_templates`,
    config.accessToken,
    {
      method: "POST",
      body: { name, category, language, components },
    }
  )

  res.status(201).json({
    template: {
      id: result.id,
      name,
      status: result.status,
      category: result.category || category,
    },
  })
}
