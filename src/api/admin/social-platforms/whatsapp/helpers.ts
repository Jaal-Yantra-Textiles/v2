import { SOCIALS_MODULE } from "../../../../modules/socials"
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
 * Resolve WhatsApp config from SocialPlatform DB or env vars.
 */
export async function getWhatsAppConfig(scope: any): Promise<WhatsAppPlatformConfig> {
  // Try DB first
  try {
    const socialsService = scope.resolve(SOCIALS_MODULE) as any
    const allComm = await socialsService.listSocialPlatforms({ category: "communication", status: "active" })
    const list = Array.isArray(allComm) ? allComm : [allComm]
    const platform = list.find(
      (p: any) => p?.api_config?.provider === "whatsapp" || p?.name === "WhatsApp"
    )

    if (platform?.api_config) {
      const apiConfig = platform.api_config as Record<string, any>
      const encryptionService = scope.resolve(ENCRYPTION_MODULE) as EncryptionService

      let accessToken = ""
      if (apiConfig.access_token_encrypted) {
        try { accessToken = encryptionService.decrypt(apiConfig.access_token_encrypted as EncryptedData) } catch {
          accessToken = apiConfig.access_token || ""
        }
      } else {
        accessToken = apiConfig.access_token || ""
      }

      if (accessToken) {
        return {
          accessToken,
          phoneNumberId: apiConfig.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID || "",
          wabaId: apiConfig.waba_id,
          appSecret: apiConfig.app_secret,
          webhookVerifyToken: apiConfig.webhook_verify_token,
          platformId: platform.id,
        }
      }
    }
  } catch { /* fall through to env */ }

  // Fallback to env vars
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
    throw new Error(data?.error?.message || `Graph API error ${resp.status}`)
  }
  return data
}
