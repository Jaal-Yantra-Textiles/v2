import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { ENCRYPTION_MODULE } from "../../../../modules/encryption"
import type EncryptionService from "../../../../modules/encryption/service"
import type { EncryptedData } from "../../../../modules/encryption"

/**
 * POST /admin/inbound-emails/setup-resend-webhook
 *
 * Uses the stored Resend API key to register the inbound webhook URL
 * via Resend's API. Automates webhook setup.
 *
 * Body: { platform_id: string, webhook_url?: string }
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  const { platform_id, webhook_url } = req.body as {
    platform_id: string
    webhook_url?: string
  }

  if (!platform_id) {
    return res.status(400).json({ error: "platform_id is required" })
  }

  // Resolve the platform
  const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
  let platform: any
  try {
    platform = await socialsService.retrieveSocialPlatform(platform_id)
  } catch {
    return res.status(404).json({ error: "Platform not found" })
  }

  const apiConfig = platform.api_config as Record<string, any>
  if (!apiConfig || apiConfig.provider !== "resend") {
    return res.status(400).json({ error: "Platform is not a Resend provider" })
  }

  // Decrypt API key
  let apiKey: string
  if (apiConfig.api_key_encrypted) {
    const encryptionService = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService
    apiKey = encryptionService.decrypt(apiConfig.api_key_encrypted as EncryptedData)
  } else if (apiConfig.api_key) {
    apiKey = apiConfig.api_key
  } else {
    return res.status(400).json({ error: "No Resend API key configured" })
  }

  // Determine the webhook URL
  const baseUrl =
    webhook_url ||
    `${req.protocol}://${req.get("host")}/webhooks/inbound-email/resend`

  try {
    const response = await fetch("https://api.resend.com/webhooks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        endpoint: baseUrl,
        events: ["email.received"],
      }),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return res.status(response.status).json({
        error: "Failed to register webhook with Resend",
        details: errorData,
      })
    }

    const webhookData = await response.json()

    return res.json({
      success: true,
      webhook_id: webhookData.id,
      webhook_url: baseUrl,
      events: ["email.received"],
    })
  } catch (err: any) {
    return res.status(500).json({
      error: "Failed to register webhook",
      details: err.message,
    })
  }
}
