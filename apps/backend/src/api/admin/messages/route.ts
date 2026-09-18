import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MESSAGING_MODULE } from "../../../modules/messaging"

/**
 * GET /admin/messages
 *
 * Read messages directly, without going through a conversation.
 *
 * 🔴 Why this exists beside `/admin/messaging/:conversationId`. That route is a
 * GET that WRITES: it zeroes the conversation's `unread_count` and sends
 * WhatsApp read receipts for up to ten unread inbound messages, marking those
 * rows `read`. It is the right behaviour for a human opening the inbox and the
 * wrong behaviour for anything that just wants to look — an audit, an agent, a
 * support question about one message. Reading a row should not tell a partner
 * their message has been read.
 *
 * So this route is strictly read-only, and it is the one the MCP tools use.
 *
 * Filters: conversation_id, direction, status, message_type, context_type,
 * context_id, wa_message_id, q (substring of content). Newest first.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const {
    conversation_id,
    direction,
    status,
    message_type,
    context_type,
    context_id,
    wa_message_id,
    q,
    limit,
    offset,
  } = (req.validatedQuery || req.query || {}) as Record<string, any>

  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  const filters: Record<string, any> = {}
  if (conversation_id) filters.conversation_id = conversation_id
  if (direction) filters.direction = direction
  if (status) filters.status = status
  if (message_type) filters.message_type = message_type
  if (context_type) filters.context_type = context_type
  if (context_id) filters.context_id = context_id
  if (wa_message_id) filters.wa_message_id = wa_message_id
  if (q) filters.content = { $ilike: `%${q}%` }

  const take = Math.min(Number(limit) || 50, 200)
  const skip = Number(offset) || 0

  const [messages, count] = await messagingService.listAndCountMessagingMessages(
    filters,
    { order: { created_at: "DESC" }, take, skip }
  )

  res.json({ messages, count, limit: take, offset: skip })
}
