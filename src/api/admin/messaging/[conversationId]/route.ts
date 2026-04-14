import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { MESSAGING_MODULE } from "../../../../modules/messaging"
import { SOCIAL_PROVIDER_MODULE } from "../../../../modules/social-provider"
import type SocialProviderService from "../../../../modules/social-provider/service"
import { buildContextSnapshot } from "../context-builder"
import type { SendMessageInput } from "../validators"

/**
 * GET /admin/messaging/:conversationId
 *
 * Get conversation details and paginated messages.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { conversationId } = req.params
  const { limit, offset } = (req.validatedQuery || {}) as any
  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any

  const conversation = await messagingService.retrieveMessagingConversation(conversationId, {
    relations: ["messages"],
  }).catch(() => null)

  if (!conversation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Conversation not found")
  }

  // Get partner info
  let partner_name = "Unknown Partner"
  try {
    const { data: partners } = await query.graph({
      entity: "partners",
      fields: ["name"],
      filters: { id: conversation.partner_id },
    })
    partner_name = partners?.[0]?.name || "Unknown Partner"
  } catch { /* fallback */ }

  // Sort messages oldest first, apply pagination
  const allMessages = conversation.messages || []
  const sorted = [...allMessages].sort(
    (a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  const skip = offset || 0
  const take = limit || 50
  const messages = sorted.slice(skip, skip + take)

  // Reset unread count when admin views the conversation
  if (conversation.unread_count > 0) {
    await messagingService.updateMessagingConversations({
      id: conversationId,
      unread_count: 0,
    }).catch(() => {})

    // Send WhatsApp read receipts for unread inbound messages
    try {
      const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
      const wa = socialProvider.getWhatsApp(req.scope)
      const unreadInbound = sorted
        .filter((m: any) => m.direction === "inbound" && m.status !== "read" && m.wa_message_id)
        .slice(-10) // last 10 unread
      for (const m of unreadInbound) {
        wa.markAsRead(m.wa_message_id).catch(() => {})
        messagingService.updateMessagingMessages({ id: m.id, status: "read" }).catch(() => {})
      }
    } catch { /* non-fatal */ }
  }

  res.json({
    conversation: {
      id: conversation.id,
      partner_id: conversation.partner_id,
      partner_name,
      title: conversation.title,
      phone_number: conversation.phone_number,
      status: conversation.status,
      unread_count: 0,
      last_message_at: conversation.last_message_at,
      metadata: conversation.metadata,
    },
    messages,
    count: allMessages.length,
    offset: skip,
    limit: take,
  })
}

/**
 * POST /admin/messaging/:conversationId
 *
 * Send a message to the partner via WhatsApp and persist it.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { conversationId } = req.params
  const body = req.validatedBody as SendMessageInput
  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  const conversation = await messagingService.retrieveMessagingConversation(conversationId).catch(() => null)
  if (!conversation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Conversation not found")
  }

  // Build context snapshot if context is provided
  let contextSnapshot: Record<string, any> | null = null
  let messageText = body.content
  let messageType = "text"

  if (body.context_type && body.context_id) {
    const { snapshot, formattedText } = await buildContextSnapshot(
      req.scope,
      body.context_type,
      body.context_id
    )
    contextSnapshot = snapshot
    messageText = `${body.content}\n\n${formattedText}`
    messageType = "context_card"
  }

  if (body.media_url) {
    messageType = "media"
  }

  // Resolve reply-to context
  let replyToSnapshot: Record<string, any> | null = null
  let replyToWaMessageId: string | undefined

  if (body.reply_to_id) {
    try {
      const replyMsg = await messagingService.retrieveMessagingMessage(body.reply_to_id)
      if (replyMsg) {
        replyToWaMessageId = replyMsg.wa_message_id || undefined
        replyToSnapshot = {
          content: replyMsg.content?.substring(0, 200) || "",
          sender_name: replyMsg.sender_name,
          direction: replyMsg.direction,
          media_url: replyMsg.media_url,
          media_mime_type: replyMsg.media_mime_type,
        }
      }
    } catch { /* non-fatal */ }
  }

  // Send via WhatsApp
  const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  const whatsapp = socialProvider.getWhatsApp(req.scope)

  let waResponse: any
  let usedTemplate = false
  let isQueued = false

  // Check conversation window state
  const conversationWithMsgs = await messagingService.retrieveMessagingConversation(conversationId, {
    relations: ["messages"],
  }).catch(() => null)
  const allMsgs = conversationWithMsgs?.messages || []
  const hasRecentInbound = allMsgs.some(
    (m: any) => m.direction === "inbound" && new Date(m.created_at).getTime() > Date.now() - 24 * 60 * 60 * 1000
  )
  const templateAlreadySent = allMsgs.some(
    (m: any) => m.message_type === "template" && m.status !== "failed"
  )
  const windowOpen = hasRecentInbound

  if (!windowOpen) {
    if (!templateAlreadySent) {
      // First contact — send template to initiate conversation
      const templateName = process.env.WHATSAPP_INITIATION_TEMPLATE || "jyt_partner_connect"
      const templateLang = process.env.WHATSAPP_INITIATION_TEMPLATE_LANG || "en"

      let partnerName = conversation.title || "there"
      try {
        const q = req.scope.resolve(ContainerRegistrationKeys.QUERY) as any
        const { data: partners } = await q.graph({
          entity: "partners",
          fields: ["name"],
          filters: { id: conversation.partner_id },
        })
        partnerName = partners?.[0]?.name || partnerName
      } catch { /* fallback */ }

      try {
        waResponse = await whatsapp.sendTemplateMessage(
          conversation.phone_number,
          templateName,
          templateLang,
          [{
            type: "body",
            parameters: [{ type: "text", text: partnerName }],
          }]
        )
        usedTemplate = true
      } catch {
        waResponse = null
      }
    }

    // Queue this message — partner hasn't responded yet, free-form won't deliver
    isQueued = true
  }

  // If window is open, send normally
  if (windowOpen) {
    try {
      if (messageType === "media" && body.media_url) {
        waResponse = await whatsapp.sendMediaMessage(
          conversation.phone_number,
          body.media_url,
          body.media_mime_type,
          body.content,
          body.media_filename
        )
      } else {
        waResponse = await whatsapp.sendTextMessage(conversation.phone_number, messageText, replyToWaMessageId)
      }
    } catch {
      waResponse = null
    }
  }
  const waMessageId = waResponse?.messages?.[0]?.id || null

  // Get admin user name
  let senderName = "Admin"
  try {
    const authContext = (req as any).auth_context
    if (authContext?.actor_id) {
      const userService = req.scope.resolve("user") as any
      const user = await userService.retrieveUser(authContext.actor_id)
      senderName = [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Admin"
    }
  } catch { /* fallback */ }

  // Persist the message
  const message = await messagingService.createMessagingMessages({
    conversation_id: conversationId,
    direction: "outbound",
    sender_name: senderName,
    content: body.content,
    message_type: messageType as any,
    wa_message_id: waMessageId,
    status: isQueued ? "queued" : (waMessageId ? "sent" : "failed"),
    context_type: body.context_type || null,
    context_id: body.context_id || null,
    context_snapshot: contextSnapshot,
    media_url: body.media_url || null,
    media_mime_type: body.media_mime_type || null,
    reply_to_id: body.reply_to_id || null,
    reply_to_snapshot: replyToSnapshot,
    metadata: body.media_filename ? { filename: body.media_filename } : null,
  })

  // Update conversation metadata
  const existingMeta = (conversation.metadata as Record<string, any>) || {}
  const updatedMeta: Record<string, any> = {
    ...existingMeta,
    consent_given: true,
    consent_given_at: existingMeta.consent_given_at || new Date().toISOString(),
    consent_source: existingMeta.consent_source || "admin_initiated",
    onboarded: true,
  }

  // Track awaiting_reply state when messages are queued
  if (isQueued && !existingMeta.awaiting_reply) {
    updatedMeta.awaiting_reply = true
    updatedMeta.template_sent_at = new Date().toISOString()
  }

  await messagingService.updateMessagingConversations({
    id: conversationId,
    last_message_at: new Date(),
    metadata: updatedMeta,
  })

  res.json({
    message,
    queued: isQueued,
    awaiting_reply: isQueued,
  })
}
