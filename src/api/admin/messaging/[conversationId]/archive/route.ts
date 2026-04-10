import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MESSAGING_MODULE } from "../../../../../modules/messaging"

/**
 * POST /admin/messaging/:conversationId/archive
 *
 * Archive a conversation.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { conversationId } = req.params
  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  const conversation = await messagingService.retrieveMessagingConversation(conversationId).catch(() => null)
  if (!conversation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Conversation not found")
  }

  await messagingService.updateMessagingConversations({
    id: conversationId,
    status: "archived",
  })

  res.json({ success: true })
}
