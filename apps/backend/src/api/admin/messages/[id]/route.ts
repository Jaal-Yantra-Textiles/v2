import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MESSAGING_MODULE } from "../../../../modules/messaging"

/**
 * GET /admin/messages/:id
 *
 * One message by its id, read-only.
 *
 * Until this existed there was no way to answer "what is message X" at all:
 * messages were reachable only through `/admin/messaging/:conversationId`,
 * which returns a whole conversation AND marks its inbound messages read. An
 * id pasted from a log or a notification had nowhere to go, and the natural
 * guess — `/admin/messages/:id` — 404'd.
 *
 * Returns the conversation's identity alongside the message, because a message
 * id on its own never answers the question actually being asked (who was this
 * to, and about what).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params
  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  const message = await messagingService
    .retrieveMessagingMessage(id)
    .catch(() => null)

  if (!message) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `Message with id ${id} was not found`
    )
  }

  const conversationId = message.conversation_id ?? message.conversation?.id ?? null
  let conversation: Record<string, any> | null = null
  if (conversationId) {
    const conv = await messagingService
      .retrieveMessagingConversation(conversationId)
      .catch(() => null)
    if (conv) {
      conversation = {
        id: conv.id,
        partner_id: conv.partner_id,
        title: conv.title,
        phone_number: conv.phone_number,
        status: conv.status,
      }
    }
  }

  res.json({ message, conversation })
}
