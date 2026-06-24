import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import crypto from "crypto"
import { SOCIAL_PROVIDER_MODULE } from "../../../../modules/social-provider"
import type SocialProviderService from "../../../../modules/social-provider/service"
import type WhatsAppService from "../../../../modules/social-provider/whatsapp-service"
import { handleIncomingMessage, resolvePartnerByPhone } from "../../../../workflows/whatsapp/whatsapp-message-handler"
import { resolveAdminByPhone, handleAdminMessage } from "../../../../workflows/whatsapp/whatsapp-admin-handler"
import { logger } from "@medusajs/framework"
import  { MESSAGING_MODULE } from "../../../../modules/messaging"

/**
 * GET /webhooks/social/whatsapp
 *
 * Meta webhook verification endpoint.
 * Meta sends hub.mode, hub.verify_token, and hub.challenge.
 *
 * Multi-number: the incoming token is accepted if it matches ANY configured
 * WhatsApp platform's verify_token, or (fallback) the legacy env-var token.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const mode = req.query["hub.mode"]
  const token = req.query["hub.verify_token"]
  const challenge = req.query["hub.challenge"]

  if (mode !== "subscribe" || typeof token !== "string") {
    return res.status(403).send("Forbidden")
  }

  const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService

  // Try each configured platform. First matching verify_token wins.
  const matched = await findPlatformMatchingVerifyToken(req.scope, socialProvider, token)
  if (matched) {
    logger.info(`[whatsapp-webhook] Verified via platform: ${matched}`)
    return res.status(200).send(challenge)
  }

  // Legacy fallback: env-var / default platform. Covers the single-number case.
  const defaultWa = socialProvider.getWhatsApp(req.scope)
  const defaultToken = await defaultWa.getWebhookVerifyToken()
  if (defaultToken && token === defaultToken) {
    logger.info("[whatsapp-webhook] Verified via default platform")
    return res.status(200).send(challenge)
  }

  logger.error("[whatsapp-webhook] Verification failed: no platform matched token")
  return res.status(403).send("Forbidden")
}

/**
 * Iterate configured WhatsApp platforms, bind each one, and compare its
 * verify_token to the incoming token. Returns the platform id on match.
 */
async function findPlatformMatchingVerifyToken(
  scope: any,
  socialProvider: SocialProviderService,
  incomingToken: string
): Promise<string | null> {
  const socials = scope.resolve("socials") as any
  let platforms: Array<any> = []
  try {
    platforms = await socials.findWhatsAppPlatforms()
  } catch {
    return null
  }

  for (const p of platforms) {
    try {
      const wa = await socialProvider.getWhatsAppForPlatform(scope, p.id)
      const platformToken = await wa.getWebhookVerifyToken()
      if (platformToken && incomingToken === platformToken) {
        return p.id
      }
    } catch {
      // Keep trying other platforms
    }
  }
  return null
}

/**
 * POST /webhooks/social/whatsapp
 *
 * Receives incoming WhatsApp messages and status updates from Meta.
 * Validates X-Hub-Signature-256 HMAC-SHA256 header.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService

  const signature = req.headers["x-hub-signature-256"] as string | undefined
  if (!signature) {
    logger.error("[whatsapp-webhook] No signature provided")
    return res.status(401).send("Unauthorized")
  }

  // Medusa's bodyParser: { preserveRawBody: true } gives us:
  // - req.rawBody: Buffer of exact bytes received (for HMAC)
  // - req.body: parsed JSON object (for processing)
  // Meta signs the exact wire bytes — we must HMAC those, not re-serialized JSON.
  const rawBody = (req as any).rawBody as Buffer | undefined

  if (!rawBody || !rawBody.length) {
    logger.error("[whatsapp-webhook] No raw body available for signature verification")
    return res.status(400).send("Empty body")
  }

  // Multi-number: try each configured platform's app_secret until one
  // verifies the signature. In most deployments all numbers share a Meta
  // app and therefore a single secret — the first attempt succeeds.
  const verified = await verifySignatureAgainstAllPlatforms(req.scope, socialProvider, signature, rawBody)
  if (!verified) {
    logger.error("[whatsapp-webhook] Invalid signature — no platform secret matched")
    return res.status(401).send("Unauthorized")
  }

  const body = req.body as WhatsAppWebhookPayload

  // Return 200 immediately (Meta requires response within 20 seconds)
  res.status(200).send("EVENT_RECEIVED")

  // Process asynchronously
  processWhatsAppWebhook(req.scope, body).catch((error) => {
    logger.error("[whatsapp-webhook] Processing failed:", error as Error)
  })
}

/**
 * Try each configured WhatsApp platform's app_secret (and the default /
 * env-var secret as final fallback) against the inbound signature. Returns
 * true on first match.
 */
async function verifySignatureAgainstAllPlatforms(
  scope: any,
  socialProvider: SocialProviderService,
  incomingSignature: string,
  rawBody: Buffer
): Promise<boolean> {
  const secrets = new Set<string>()

  // Per-platform secrets
  try {
    const socials = scope.resolve("socials") as any
    const platforms: any[] = await socials.findWhatsAppPlatforms()
    for (const p of platforms) {
      try {
        const wa = await socialProvider.getWhatsAppForPlatform(scope, p.id)
        const s = await wa.getAppSecret()
        if (s) secrets.add(s)
      } catch {
        // Try next platform
      }
    }
  } catch {
    // No platforms configured — fall through to default
  }

  // Default / env-var secret (covers single-number legacy path)
  try {
    const defaultSecret = await socialProvider.getWhatsApp(scope).getAppSecret()
    if (defaultSecret) secrets.add(defaultSecret)
  } catch {
    // no-op
  }

  for (const secret of secrets) {
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`
    if (
      incomingSignature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(incomingSignature), Buffer.from(expected))
    ) {
      return true
    }
  }
  return false
}

async function processWhatsAppWebhook(
  scope: any,
  payload: WhatsAppWebhookPayload
): Promise<void> {
  const logger: any = scope.resolve(ContainerRegistrationKeys.LOGGER)
  if (payload.object !== "whatsapp_business_account") {
    logger.info(`[whatsapp-webhook] Ignoring non-WhatsApp object: ${payload.object}`)
    return
  }

  const socialProvider = scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "messages") continue

      const value = change.value
      if (!value) continue

      // Multi-number routing: resolve which WhatsApp platform this delivery
      // belongs to based on metadata.phone_number_id. Falls back to the
      // default sender when the platform isn't configured (keeps legacy
      // behavior and is forgiving of mis-configured inbound numbers).
      const inboundPhoneNumberId = value.metadata?.phone_number_id
      let boundWa: WhatsAppService | null = null
      if (inboundPhoneNumberId) {
        try {
          boundWa = await socialProvider.getWhatsAppForInboundPhoneNumberId(
            scope,
            inboundPhoneNumberId
          )
          if (!boundWa) {
            logger.warn(
              `[whatsapp-webhook] Inbound phone_number_id not configured as a SocialPlatform: ${inboundPhoneNumberId} — falling back to default sender`
            )
          }
        } catch (e: any) {
          logger.warn(`[whatsapp-webhook] Platform resolution failed: ${e.message}`)
        }
      }
      const wa = boundWa ?? socialProvider.getWhatsApp(scope)

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
            logger.warn(`[whatsapp-webhook] Failed to update message status: ${e.message}`)
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
            logger.info(`[whatsapp-webhook] Skipping duplicate message: ${msg.id}`)
            continue
          }
        } catch { /* proceed if check fails */ }

        // Log the full raw message shape (not just {from,type,id}) so we
        // can recover from future parser-gap bugs. Meta has no API to
        // retrieve a past webhook body by wamid — the only record is what
        // we log at receive time. Previously a template button tap arrived
        // as type "button", the parser returned null, and the payload was
        // lost forever. Now: log first, parse second.
        try {
          logger.info(
            `[whatsapp-webhook] Incoming message (raw): ${JSON.stringify(msg)}`
          )
        } catch {
          // Extremely unlikely but don't let logging crash the handler
          logger.info(`[whatsapp-webhook] Incoming message: from=${msg.from} type=${msg.type} id=${msg.id}`)
        }

        try {
          const incomingMessage = parseWebhookMessage(msg)
          if (!incomingMessage) {
            // Parser didn't know how to normalize this type. We already
            // logged the raw body above, so this line is just an operator
            // signal that a new type showed up and needs a case added to
            // parseWebhookMessage() below.
            logger.warn(
              `[whatsapp-webhook] Parser returned null — unhandled type. See raw log above. Add a case to parseWebhookMessage(). from=${msg.from} type=${msg.type} id=${msg.id}`
            )
            continue
          }

          // Resolve media URL from Meta using the platform this message
          // arrived on (access tokens are per-number in general).
          if (incomingMessage.mediaId) {
            try {
              const media = await wa.getMediaUrl(incomingMessage.mediaId)
              if (media?.url) {
                incomingMessage.mediaUrl = media.url
                if (media.mime_type) incomingMessage.mediaMimeType = media.mime_type
              }
            } catch (e: any) {
              logger.warn(`[whatsapp-webhook] Failed to resolve media URL: ${e.message}`)
            }
          }

          // Check if sender is an admin user first.
          // Handlers receive the sender-bound wa so replies go out from the
          // same number that received the inbound message.
          const admin = await resolveAdminByPhone(scope, incomingMessage.from)
          const partner = admin ? null : await resolvePartnerByPhone(scope, incomingMessage.from)

          // Emit a generic event so visual flows can subscribe to inbound
          // WhatsApp messages without authoring custom subscribers. Partner /
          // admin handlers below still run unchanged — the event is additive.
          // Fire-and-forget: an emit failure must not break message handling.
          try {
            const eventBus = scope.resolve(Modules.EVENT_BUS) as any
            await eventBus.emit([{
              name: "whatsapp.message_received",
              data: {
                from: incomingMessage.from,
                message_id: incomingMessage.messageId,
                type: incomingMessage.type,
                text: incomingMessage.text ?? null,
                caption: incomingMessage.text ?? null,
                media_ids: incomingMessage.mediaId ? [incomingMessage.mediaId] : [],
                media_url: incomingMessage.mediaUrl ?? null,
                media_mime_type: incomingMessage.mediaMimeType ?? null,
                reply_to_wa_message_id: incomingMessage.replyToWaMessageId ?? null,
                sender_platform_id: wa.getSenderPlatformId?.() ?? null,
                partner_id: partner?.partnerId ?? null,
                partner_name: partner?.adminName ?? null,
                admin_user_id: admin?.userId ?? null,
              },
            }])
          } catch (e: any) {
            logger.warn(`[whatsapp-webhook] Failed to emit whatsapp.message_received: ${e.message}`)
          }

          if (admin) {
            const result = await handleAdminMessage(scope, incomingMessage, admin, wa)
            logger.info(`[whatsapp-webhook] Admin handled: ${JSON.stringify(result)}`)
          } else {
            // Fall back to partner handler
            const result = await handleIncomingMessage(scope, incomingMessage, wa)
            logger.info(`[whatsapp-webhook] Partner handled: ${JSON.stringify(result)}`)
          }
        } catch (error: any) {
          logger.error(`[whatsapp-webhook] Failed to handle message: ${error.message}`)
        }
      }
    }
  }
}

interface ParsedWhatsAppMessage {
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
}

function parseWebhookMessage(msg: any): ParsedWhatsAppMessage | null {
  const from: string = msg.from
  const messageId: string = msg.id
  const replyToWaMessageId: string | undefined = msg.context?.id || undefined

  switch (msg.type) {
    case "text":
      return { from, messageId, replyToWaMessageId, type: "text", text: msg.text?.body }

    case "interactive":
      if (msg.interactive?.type === "button_reply") {
        return {
          from, messageId, replyToWaMessageId,
          type: "interactive",
          buttonReplyId: msg.interactive.button_reply?.id,
          buttonReplyTitle: msg.interactive.button_reply?.title,
        }
      }
      if (msg.interactive?.type === "list_reply") {
        return {
          from, messageId, replyToWaMessageId,
          type: "interactive",
          buttonReplyId: msg.interactive.list_reply?.id,
          buttonReplyTitle: msg.interactive.list_reply?.title,
        }
      }
      return null

    // Template quick-reply button tap — Meta sends top-level type "button"
    // (not "interactive"). Shape: { button: { payload, text } }. Normalize
    // to the interactive shape so the downstream handler — which already
    // resolves actions via BUTTON_TITLE_ACTIONS + conversation
    // pending_run_id — processes it without a second code path.
    case "button":
      return {
        from, messageId, replyToWaMessageId,
        type: "interactive",
        buttonReplyId: msg.button?.payload,
        buttonReplyTitle: msg.button?.text,
      }

    case "image":
      return {
        from, messageId, replyToWaMessageId,
        type: "image",
        mediaId: msg.image?.id,
        mediaMimeType: msg.image?.mime_type,
        text: msg.image?.caption,
      }

    case "video":
      return {
        from, messageId, replyToWaMessageId,
        type: "video",
        mediaId: msg.video?.id,
        mediaMimeType: msg.video?.mime_type,
        text: msg.video?.caption,
      }

    case "document":
      return {
        from, messageId, replyToWaMessageId,
        type: "document",
        mediaId: msg.document?.id,
        mediaMimeType: msg.document?.mime_type,
        text: msg.document?.caption,
      }

    case "audio":
      return {
        from, messageId, replyToWaMessageId,
        type: "audio",
        mediaId: msg.audio?.id,
        mediaMimeType: msg.audio?.mime_type,
      }

    default:
      // Unhandled types (e.g. "reaction", "order", "sticker", future Meta
      // additions). The full raw body was logged upstream — this warning
      // just names the type so an operator can grep quickly and add the
      // case here.
      logger.warn(
        `[whatsapp-webhook] Unsupported message type — add case to parseWebhookMessage: ${msg.type}`
      )
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
