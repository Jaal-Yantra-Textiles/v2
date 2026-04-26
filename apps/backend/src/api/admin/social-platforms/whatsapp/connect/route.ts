import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../../../modules/encryption"
import type EncryptionService from "../../../../../modules/encryption/service"

interface ConnectWhatsAppBody {
  access_token: string
  phone_number_id: string
  webhook_verify_token?: string
  app_secret?: string
}

/**
 * POST /admin/social-platforms/whatsapp/connect
 *
 * Creates or updates a WhatsApp SocialPlatform record with encrypted credentials.
 * This allows the WhatsApp service to read config from the database instead of env vars.
 */
export const POST = async (
  req: MedusaRequest<ConnectWhatsAppBody>,
  res: MedusaResponse
) => {
  const { access_token, phone_number_id, webhook_verify_token, app_secret } = req.validatedBody

  if (!access_token || !phone_number_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "access_token and phone_number_id are required"
    )
  }

  const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
  const encryptionService = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService

  // Build encrypted api_config
  const apiConfig: Record<string, any> = {
    provider: "whatsapp",
    phone_number_id,
    access_token_encrypted: encryptionService.encrypt(access_token),
    access_token, // backward compat — will be removed
  }

  if (webhook_verify_token) {
    apiConfig.webhook_verify_token_encrypted = encryptionService.encrypt(webhook_verify_token)
    apiConfig.webhook_verify_token = webhook_verify_token
  }

  if (app_secret) {
    apiConfig.app_secret_encrypted = encryptionService.encrypt(app_secret)
    apiConfig.app_secret = app_secret
  }

  // Check if a WhatsApp platform already exists (filter by category + check api_config.provider)
  const allComm = await socialsService.listSocialPlatforms(
    { category: "communication" }
  )

  const platforms = Array.isArray(allComm) ? allComm : [allComm]
  const existingPlatform = platforms.find(
    (p: any) => p?.api_config?.provider === "whatsapp" || p?.name === "WhatsApp"
  )

  let platform: any

  if (existingPlatform?.id) {
    // Update existing
    platform = await socialsService.updateSocialPlatforms({
      selector: { id: existingPlatform.id },
      data: {
        api_config: apiConfig,
        status: "active",
        category: "communication",
        auth_type: "bearer",
      },
    })
  } else {
    // Create new
    platform = await socialsService.createSocialPlatforms({
      name: "WhatsApp",
      category: "communication",
      auth_type: "bearer",
      status: "active",
      description: "WhatsApp Business API via Meta Cloud API",
      base_url: "https://graph.facebook.com/v21.0",
      api_config: apiConfig,
    })
  }

  const result = Array.isArray(platform) ? platform[0] : platform

  res.status(200).json({
    socialPlatform: {
      id: result.id,
      name: result.name,
      category: result.category,
      status: result.status,
      connected: true,
    },
  })
}

/**
 * GET /admin/social-platforms/whatsapp/connect
 *
 * Returns the current WhatsApp connection status (without exposing secrets).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialsService = req.scope.resolve(SOCIALS_MODULE) as any

  const allComm = await socialsService.listSocialPlatforms(
    { category: "communication" }
  )

  const platforms = Array.isArray(allComm) ? allComm : [allComm]
  const platform = platforms.find(
    (p: any) => p?.api_config?.provider === "whatsapp" || p?.name === "WhatsApp"
  )

  if (!platform?.id) {
    return res.status(200).json({
      connected: false,
      source: process.env.WHATSAPP_ACCESS_TOKEN ? "env" : "none",
    })
  }

  const apiConfig = platform.api_config as Record<string, any> | null

  res.status(200).json({
    connected: true,
    source: "database",
    platform: {
      id: platform.id,
      name: platform.name,
      status: platform.status,
      phone_number_id: apiConfig?.phone_number_id || null,
      has_access_token: !!(apiConfig?.access_token_encrypted || apiConfig?.access_token),
      has_webhook_verify_token: !!(apiConfig?.webhook_verify_token_encrypted || apiConfig?.webhook_verify_token),
      has_app_secret: !!(apiConfig?.app_secret_encrypted || apiConfig?.app_secret),
    },
  })
}
