import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"
import { SOCIAL_PROVIDER_MODULE } from "../../../../modules/social-provider"
import type SocialProviderService from "../../../../modules/social-provider/service"
import { handleIncomingMessage } from "../../../../modules/social-provider/whatsapp-message-handler"
import  { MESSAGING_MODULE } from "../../../../modules/messaging"

/**
 * GET /webhooks/social/whatsapp
 *
 * Meta webhook verification endpoint.
 * Meta sends hub.mode, hub.verify_token, and hub.challenge.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const mode = req.query["hub.mode"]
  const token = req.query["hub.verify_token"]
  const challenge = req.query["hub.challenge"]

  const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  const whatsapp = socialProvider.getWhatsApp(req.scope)
  const verifyToken = await whatsapp.getWebhookVerifyToken()

  if (!verifyToken) {
    console.error("[whatsapp-webhook] Webhook verify token not configured (env or SocialPlatform)")
    return res.status(500).send("Webhook verification token not configured")
  }

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[whatsapp-webhook] Verified successfully")
    return res.status(200).send(challenge)
  }

  console.error("[whatsapp-webhook] Verification failed:", { mode, token })
  return res.status(403).send("Forbidden")
}

/**
 * POST /webhooks/social/whatsapp
 *
 * Receives incoming WhatsApp messages and status updates from Meta.
 * Validates X-Hub-Signature-256 HMAC-SHA256 header.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  const whatsapp = socialProvider.getWhatsApp(req.scope)
  const appSecret = await whatsapp.getAppSecret()

  if (!appSecret) {
    console.error("[whatsapp-webhook] App secret not configured")
    return res.status(500).send("Webhook not configured")
  }

  const signature = req.headers["x-hub-signature-256"] as string | undefined
  if (!signature) {
    console.error("[whatsapp-webhook] No signature provided")
    return res.status(401).send("Unauthorized")
  }

  // Read raw body for signature validation
  let rawBody = ""
  await new Promise<void>((resolve, reject) => {
    req.on("data", (chunk) => {
      rawBody += chunk.toString("utf8")
    })
    req.on("end", () => resolve())
    req.on("error", (err) => reject(err))
  })

  // Validate HMAC
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex")

  if (`sha256=${expectedSignature}` !== signature) {
    console.error("[whatsapp-webhook] Invalid signature")
    return res.status(401).send("Unauthorized")
  }

  const body = JSON.parse(rawBody) as WhatsAppWebhookPayload

  // Return 200 immediately (Meta requires response within 20 seconds)
  res.status(200).send("EVENT_RECEIVED")

  // Process asynchronously
  processWhatsAppWebhook(req.scope, body).catch((error) => {
    console.error("[whatsapp-webhook] Processing failed:", error)
  })
}

async function processWhatsAppWebhook(
  scope: any,
  payload: WhatsAppWebhookPayload
): Promise<void> {
  if (payload.object !== "whatsapp_business_account") {
    console.log("[whatsapp-webhook] Ignoring non-WhatsApp object:", payload.object)
    return
  }

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue

      const value = change.value
      if (!value) continue

      // Handle message status updates (sent, delivered, read)
      if (value.statuses?.length) {
        for (const status of value.statuses) {
          console.log("[whatsapp-webhook] Status update:", {
            messageId: status.id,
            status: status.status,
            recipientId: status.recipient_id,
          })

          // Update persisted message status
          try {
           
            const messagingService = scope.resolve(MESSAGING_MODULE) as any
            const [existing] = await messagingService.listMessagingMessages(
              { wa_message_id: status.id },
              { take: 1 }
            )
            if (existing) {
              await messagingService.updateMessagingMessages({
                id: existing.id,
                status: status.status as any,
              })
            }
          } catch (e: any) {
            console.warn("[whatsapp-webhook] Failed to update message status:", e.message)
          }
        }
        continue
      }

      // Handle incoming messages
      for (const msg of value.messages || []) {
        console.log("[whatsapp-webhook] Incoming message:", {
          from: msg.from,
          type: msg.type,
          id: msg.id,
        })

        try {
          const incomingMessage = parseWebhookMessage(msg)
          if (incomingMessage) {
            const result = await handleIncomingMessage(scope, incomingMessage)
            console.log("[whatsapp-webhook] Handled:", result)
          }
        } catch (error: any) {
          console.error("[whatsapp-webhook] Failed to handle message:", error.message)
        }
      }
    }
  }
}

function parseWebhookMessage(msg: any): {
  from: string
  messageId: string
  type: "text" | "interactive" | "image" | "document" | "video" | "audio"
  text?: string
  buttonReplyId?: string
  buttonReplyTitle?: string
  mediaId?: string
  mediaMimeType?: string
} | null {
  const base = {
    from: msg.from,
    messageId: msg.id,
  }

  switch (msg.type) {
    case "text":
      return { ...base, type: "text", text: msg.text?.body }

    case "interactive":
      if (msg.interactive?.type === "button_reply") {
        return {
          ...base,
          type: "interactive",
          buttonReplyId: msg.interactive.button_reply?.id,
          buttonReplyTitle: msg.interactive.button_reply?.title,
        }
      }
      if (msg.interactive?.type === "list_reply") {
        return {
          ...base,
          type: "interactive",
          buttonReplyId: msg.interactive.list_reply?.id,
          buttonReplyTitle: msg.interactive.list_reply?.title,
        }
      }
      return null

    case "image":
      return {
        ...base,
        type: "image",
        mediaId: msg.image?.id,
        mediaMimeType: msg.image?.mime_type,
        text: msg.image?.caption,
      }

    case "video":
      return {
        ...base,
        type: "video",
        mediaId: msg.video?.id,
        mediaMimeType: msg.video?.mime_type,
        text: msg.video?.caption,
      }

    case "document":
      return {
        ...base,
        type: "document",
        mediaId: msg.document?.id,
        mediaMimeType: msg.document?.mime_type,
        text: msg.document?.caption,
      }

    default:
      console.log("[whatsapp-webhook] Unsupported message type:", msg.type)
      return null
  }
}

// Type definitions

interface WhatsAppWebhookPayload {
  object: string
  entry: Array<{
    id: string
    changes: Array<{
      field: string
      value: {
        messaging_product?: string
        metadata?: { display_phone_number: string; phone_number_id: string }
        contacts?: Array<{ profile: { name: string }; wa_id: string }>
        messages?: Array<any>
        statuses?: Array<{
          id: string
          status: string
          timestamp: string
          recipient_id: string
        }>
      }
    }>
  }>
}
