import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MESSAGING_MODULE } from "../../../../../modules/messaging"

/**
 * DELETE /admin/messaging/:conversationId
 *
 * Delete a conversation and all its messages.
 */
export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { conversationId } = req.params
  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  const conversation = await messagingService.retrieveMessagingConversation(conversationId).catch(() => null)
  if (!conversation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Conversation not found")
  }

  await messagingService.deleteMessagingConversations(conversationId)

  res.json({ success: true, deleted_id: conversationId })
}
