import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import crypto from "crypto"
import { SOCIAL_PROVIDER_MODULE } from "../../../../modules/social-provider"
import type SocialProviderService from "../../../../modules/social-provider/service"
import { handleIncomingMessage } from "../../../../workflows/whatsapp/whatsapp-message-handler"
import { resolveAdminByPhone, handleAdminMessage } from "../../../../workflows/whatsapp/whatsapp-admin-handler"
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

  // Medusa's bodyParser: { preserveRawBody: true } gives us:
  // - req.rawBody: Buffer of exact bytes received (for HMAC)
  // - req.body: parsed JSON object (for processing)
  // Meta signs the exact wire bytes — we must HMAC those, not re-serialized JSON.
  const rawBody = (req as any).rawBody as Buffer | undefined

  if (!rawBody || !rawBody.length) {
    console.error("[whatsapp-webhook] No raw body available for signature verification")
    return res.status(400).send("Empty body")
  }

  // Validate HMAC-SHA256 signature using timing-safe comparison
  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(rawBody)
    .digest("hex")

  const expected = `sha256=${expectedSignature}`
  if (
    signature.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    console.error("[whatsapp-webhook] Invalid signature")
    return res.status(401).send("Unauthorized")
  }

  const body = req.body as WhatsAppWebhookPayload

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

      // Handle message status updates (sent → delivered → read)
      if (value.statuses?.length) {
        const STATUS_RANK: Record<string, number> = {
          pending: 0,
          sent: 1,
          delivered: 2,
          read: 3,
          failed: 4,
        }

        for (const status of value.statuses) {
          // Update all messages matching this wa_message_id (handles duplicates)
          try {
            const messagingService = scope.resolve(MESSAGING_MODULE) as any
            const [allMatches] = await messagingService.listAndCountMessagingMessages(
              { wa_message_id: status.id },
              { take: 50 }
            )

            for (const msg of allMatches || []) {
              const currentRank = STATUS_RANK[msg.status] ?? 0
              const newRank = STATUS_RANK[status.status] ?? 0

              // Only progress forward (sent → delivered → read), never downgrade
              // Exception: "failed" always applies
              if (newRank > currentRank || status.status === "failed") {
                await messagingService.updateMessagingMessages({
                  id: msg.id,
                  status: status.status as any,
                })
              }
            }
          } catch (e: any) {
            console.warn("[whatsapp-webhook] Failed to update message status:", e.message)
          }
        }
        continue
      }

      // Handle incoming messages
      for (const msg of value.messages || []) {
        // Dedup: skip if we've already processed this message ID
        try {
          const messagingService = scope.resolve(MESSAGING_MODULE) as any
          const [alreadyExists] = await messagingService.listMessagingMessages(
            { wa_message_id: msg.id },
            { take: 1 }
          )
          if (alreadyExists) {
            console.log("[whatsapp-webhook] Skipping duplicate message:", msg.id)
            continue
          }
        } catch { /* proceed if check fails */ }

        console.log("[whatsapp-webhook] Incoming message:", {
          from: msg.from,
          type: msg.type,
          id: msg.id,
        })

        try {
          const incomingMessage = parseWebhookMessage(msg)
          if (!incomingMessage) continue

          // Resolve media URL from Meta if message has a mediaId
          if (incomingMessage.mediaId) {
            try {
              const socialProvider = scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
              const wa = socialProvider.getWhatsApp(scope)
              const media = await wa.getMediaUrl(incomingMessage.mediaId)
              if (media?.url) {
                incomingMessage.mediaUrl = media.url
                if (media.mime_type) incomingMessage.mediaMimeType = media.mime_type
              }
            } catch (e: any) {
              console.warn("[whatsapp-webhook] Failed to resolve media URL:", e.message)
            }
          }

          // Check if sender is an admin user first
          const admin = await resolveAdminByPhone(scope, incomingMessage.from)
          if (admin) {
            const result = await handleAdminMessage(scope, incomingMessage, admin)
            console.log("[whatsapp-webhook] Admin handled:", result)
          } else {
            // Fall back to partner handler
            const result = await handleIncomingMessage(scope, incomingMessage)
            console.log("[whatsapp-webhook] Partner handled:", result)
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
  mediaUrl?: string
  mediaMimeType?: string
  replyToWaMessageId?: string
} | null {
  const base: Record<string, any> = {
    from: msg.from,
    messageId: msg.id,
  }

  // WhatsApp includes context.id when user replies to a specific message
  if (msg.context?.id) {
    base.replyToWaMessageId = msg.context.id
  }

  switch (msg.type) {
    case "text":
      return { ...base, type: "text", text: msg.text?.body } as any

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

    case "audio":
      return {
        ...base,
        type: "audio",
        mediaId: msg.audio?.id,
        mediaMimeType: msg.audio?.mime_type,
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
