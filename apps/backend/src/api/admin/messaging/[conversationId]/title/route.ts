import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MESSAGING_MODULE } from "../../../../../modules/messaging"

/**
 * POST /admin/messaging/:conversationId/title
 * Update the conversation title.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { conversationId } = req.params
  const { title } = req.body as { title: string }

  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  await messagingService.updateMessagingConversations({
    id: conversationId,
    title,
  })

  res.json({ success: true, title })
}
