import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getWhatsAppConfig, graphApiRequest } from "../../helpers"

/**
 * GET /admin/social-platforms/whatsapp/templates/:templateId
 *
 * Get a single template's details from Meta.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { templateId } = req.params
  const config = await getWhatsAppConfig(req.scope)

  if (!config.accessToken) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "WhatsApp not configured")
  }

  const data = await graphApiRequest(
    `${templateId}?fields=id,name,status,category,language,components,quality_score`,
    config.accessToken
  )

  res.json({ template: data })
}

/**
 * DELETE /admin/social-platforms/whatsapp/templates/:templateId
 *
 * Delete a template from Meta. Requires the template name (passed as query param).
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const config = await getWhatsAppConfig(req.scope)
  const name = req.query.name as string

  if (!config.accessToken || !config.wabaId) {
    throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "WhatsApp or WABA ID not configured")
  }

  if (!name) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Template name is required as query param ?name=...")
  }

  await graphApiRequest(
    `${config.wabaId}/message_templates?name=${name}`,
    config.accessToken,
    { method: "DELETE" }
  )

  res.json({ success: true, deleted: name })
}
