import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Webhook } from "svix"
import { SOCIALS_MODULE } from "../../../../modules/socials"
import { INBOUND_EMAIL_MODULE } from "../../../../modules/inbound_emails"
import { ENCRYPTION_MODULE } from "../../../../modules/encryption"
import type EncryptionService from "../../../../modules/encryption/service"
import type { EncryptedData } from "../../../../modules/encryption"

/**
 * POST /webhooks/inbound-email/resend
 *
 * Receives inbound email events from Resend via Svix webhook delivery.
 * Verifies the webhook signature, parses the email payload, and creates
 * an InboundEmail record.
 */
export const POST = async (
  req: MedusaRequest,
  res: MedusaResponse
) => {
  // Read raw body for signature verification
  let rawBody = ""
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      rawBody += chunk.toString("utf8")
    })
    req.on("end", () => resolve())
    req.on("error", (err) => reject(err))
  })

  // Look up the Resend provider config from SocialPlatform
  const socialsService = req.scope.resolve(SOCIALS_MODULE) as any
  const platforms = await socialsService.listSocialPlatforms({})
  const resendPlatform = platforms.find(
    (p: any) =>
      p.category === "email" &&
      p.status === "active" &&
      (p.api_config as any)?.provider === "resend"
  )

  if (!resendPlatform) {
    console.error("[Resend Webhook] No active Resend email provider configured")
    return res.status(404).send("Resend provider not configured")
  }

  // Decrypt the webhook signing secret
  const apiConfig = resendPlatform.api_config as Record<string, any>
  let signingSecret: string

  if (apiConfig.webhook_signing_secret_encrypted) {
    const encryptionService = req.scope.resolve(ENCRYPTION_MODULE) as EncryptionService
    signingSecret = encryptionService.decrypt(
      apiConfig.webhook_signing_secret_encrypted as EncryptedData
    )
  } else if (apiConfig.webhook_signing_secret) {
    signingSecret = apiConfig.webhook_signing_secret
  } else {
    console.error("[Resend Webhook] No webhook signing secret configured")
    return res.status(500).send("Webhook signing secret not configured")
  }

  // Verify Svix signature
  const svixId = req.headers["svix-id"] as string
  const svixTimestamp = req.headers["svix-timestamp"] as string
  const svixSignature = req.headers["svix-signature"] as string

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.error("[Resend Webhook] Missing Svix headers")
    return res.status(401).send("Missing signature headers")
  }

  let payload: any
  try {
    const wh = new Webhook(signingSecret)
    payload = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as any
  } catch (err: any) {
    console.error("[Resend Webhook] Signature verification failed:", err.message)
    return res.status(401).send("Invalid signature")
  }

  // Return 200 immediately
  res.status(200).send("OK")

  // Process the event asynchronously
  processResendEvent(req.scope, payload).catch((error) => {
    console.error("[Resend Webhook] Failed to process event:", error)
  })
}

async function processResendEvent(scope: any, payload: any): Promise<void> {
  const type = payload.type

  if (type !== "email.received") {
    console.log("[Resend Webhook] Ignoring event type:", type)
    return
  }

  const data = payload.data
  const inboundEmailService = scope.resolve(INBOUND_EMAIL_MODULE) as any

  // Extract email fields from Resend payload
  const from = data.from || data.envelope?.from || "unknown"
  const to = data.to || data.envelope?.to || []
  const toAddresses = Array.isArray(to) ? to : [to]
  const subject = data.subject || "(no subject)"
  const html = data.html || ""
  const text = data.text || null
  const messageId =
    data.headers?.["message-id"] || data.message_id || data.id || null
  const receivedAt = data.created_at ? new Date(data.created_at) : new Date()

  try {
    await inboundEmailService.createInboundEmails({
      imap_uid: payload.data.id || payload.id || `resend_${Date.now()}`,
      message_id: messageId,
      from_address: from,
      to_addresses: toAddresses,
      subject,
      html_body: html,
      text_body: text,
      folder: "resend_inbound",
      received_at: receivedAt,
      status: "received",
      metadata: {
        source: "resend",
        resend_event_id: payload.id || null,
        resend_event_type: type,
      },
    })
    console.log(
      `[Resend Webhook] Stored email: "${subject}" from ${from}`
    )
  } catch (err: any) {
    console.error("[Resend Webhook] Failed to store email:", err.message)
  }
}
