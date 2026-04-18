import { MedusaError } from "@medusajs/framework/utils"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import type SocialsService from "../../../../modules/socials/service"
import { ENCRYPTION_MODULE } from "../../../../modules/encryption"
import type EncryptionService from "../../../../modules/encryption/service"
import type { EncryptedData } from "../../../../modules/encryption"

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0"

export interface WhatsAppPlatformConfig {
  accessToken: string
  phoneNumberId: string
  wabaId?: string
  appSecret?: string
  webhookVerifyToken?: string
  platformId?: string
}

/**
 * Convert a SocialPlatform row into a resolved WhatsApp config, decrypting
 * the access token when stored encrypted.
 */
function buildConfigFromPlatform(
  platform: any,
  encryptionService: EncryptionService
): WhatsAppPlatformConfig | null {
  const apiConfig = (platform?.api_config as Record<string, any>) || null
  if (!apiConfig) return null

  let accessToken = ""
  if (apiConfig.access_token_encrypted) {
    try {
      accessToken = encryptionService.decrypt(apiConfig.access_token_encrypted as EncryptedData)
    } catch {
      accessToken = apiConfig.access_token || ""
    }
  } else {
    accessToken = apiConfig.access_token || ""
  }

  if (!accessToken) return null

  return {
    accessToken,
    phoneNumberId: apiConfig.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    wabaId: apiConfig.waba_id,
    appSecret: apiConfig.app_secret,
    webhookVerifyToken: apiConfig.webhook_verify_token,
    platformId: platform.id,
  }
}

/**
 * Resolve WhatsApp config from SocialPlatform DB or env vars.
 *
 * With multi-number support, callers should pass `platformId` to target a
 * specific WhatsApp number. When omitted, falls back to the default WhatsApp
 * platform (explicit `is_default: true`, else the first active row), then to
 * env vars if no DB row exists.
 *
 * Throws NOT_FOUND when an explicit `platformId` is passed but the row does
 * not exist or is not a WhatsApp platform — surfacing bad ids early instead
 * of silently masking them with another number's config.
 */
export async function getWhatsAppConfig(
  scope: any,
  platformId?: string
): Promise<WhatsAppPlatformConfig> {
  const socialsService = scope.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const encryptionService = scope.resolve(ENCRYPTION_MODULE) as EncryptionService

  // Targeted lookup: the admin opened platform X's detail page and wants
  // to act on that row specifically (not "whichever was first").
  if (platformId) {
    const platform = await socialsService.findWhatsAppPlatformById(platformId)
    if (!platform) {
      throw new MedusaError(
        MedusaError.Types.NOT_FOUND,
        `WhatsApp platform ${platformId} not found`
      )
    }
    const cfg = buildConfigFromPlatform(platform, encryptionService)
    if (cfg) return cfg
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `WhatsApp platform ${platformId} has no access token configured`
    )
  }

  // No target: pick the default row (is_default → else first).
  try {
    const platform = await socialsService.getDefaultWhatsAppPlatform()
    if (platform) {
      const cfg = buildConfigFromPlatform(platform, encryptionService)
      if (cfg) return cfg
    }
  } catch { /* fall through to env */ }

  return {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    wabaId: process.env.WHATSAPP_WABA_ID,
    appSecret: process.env.WHATSAPP_APP_SECRET || process.env.FACEBOOK_CLIENT_SECRET,
    webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  }
}

/**
 * Make an authenticated request to Meta's Graph API.
 */
export async function graphApiRequest(
  path: string,
  accessToken: string,
  options?: { method?: string; body?: any }
): Promise<any> {
  const url = path.startsWith("http") ? path : `${GRAPH_API_BASE}/${path}`
  const resp = await fetch(url, {
    method: options?.method || "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  })

  const data = await resp.json()
  if (!resp.ok) {
    const err = data?.error || {}
    const detail = err.error_user_msg || err.error_user_title || ""
    const msg = err.message || `Graph API error ${resp.status}`
    throw new Error(detail ? `${msg} — ${detail}` : msg)
  }
  return data
}
