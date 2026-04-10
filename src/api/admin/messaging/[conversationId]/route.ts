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

  res.json({
    conversation: {
      id: conversation.id,
      partner_id: conversation.partner_id,
      partner_name,
      title: conversation.title,
      phone_number: conversation.phone_number,
      status: conversation.status,
      unread_count: conversation.unread_count,
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

  // Send via WhatsApp
  const socialProvider = req.scope.resolve(SOCIAL_PROVIDER_MODULE) as SocialProviderService
  const whatsapp = socialProvider.getWhatsApp(req.scope)

  const waResponse = await whatsapp.sendTextMessage(conversation.phone_number, messageText)
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
    status: waMessageId ? "sent" : "failed",
    context_type: body.context_type || null,
    context_id: body.context_id || null,
    context_snapshot: contextSnapshot,
    media_url: body.media_url || null,
    media_mime_type: body.media_mime_type || null,
  })

  // Update conversation
  await messagingService.updateMessagingConversations({
    id: conversationId,
    last_message_at: new Date(),
  })

  res.json({ message })
}
