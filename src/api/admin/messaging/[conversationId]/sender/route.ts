import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { MESSAGING_MODULE } from "../../../../../modules/messaging"
import { SOCIALS_MODULE } from "../../../../../modules/socials"
import type SocialsService from "../../../../../modules/socials/service"

/**
 * PATCH /admin/messaging/:conversationId/sender
 *
 * Pin a specific WhatsApp sender (SocialPlatform row) to this conversation.
 * Pass `{ platform_id: null }` to unpin and fall back to country-code /
 * default routing.
 *
 * Body:
 *   { platform_id: string | null }
 */
export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const { conversationId } = req.params
  const body = (req.body ?? {}) as { platform_id?: string | null }

  const messagingService = req.scope.resolve(MESSAGING_MODULE) as any

  const conversation = await messagingService
    .retrieveMessagingConversation(conversationId)
    .catch(() => null)
  if (!conversation) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Conversation not found")
  }

  // Unpin: explicit null clears the pinned sender.
  if (body.platform_id === null || body.platform_id === "") {
    await messagingService.updateMessagingConversations({
      id: conversationId,
      default_sender_platform_id: null,
    })
    return res.json({ ok: true, default_sender_platform_id: null })
  }

  if (typeof body.platform_id !== "string") {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "platform_id must be a string id or null to unpin"
    )
  }

  // Validate the platform exists and is a WhatsApp row before saving.
  const socials = req.scope.resolve(SOCIALS_MODULE) as unknown as SocialsService
  const platform = await socials.findWhatsAppPlatformById(body.platform_id)
  if (!platform) {
    throw new MedusaError(
      MedusaError.Types.NOT_FOUND,
      `WhatsApp platform not found: ${body.platform_id}`
    )
  }

  await messagingService.updateMessagingConversations({
    id: conversationId,
    default_sender_platform_id: platform.id,
  })

  res.json({ ok: true, default_sender_platform_id: platform.id })
}
