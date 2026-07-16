/**
 * Partner assistant conversation history (#338 item 2).
 *
 *   GET  /partners/assistant/conversations   → list this partner's saved chats
 *                                              (light: no message bodies)
 *   POST /partners/assistant/conversations   → create a new conversation
 *
 * Server-persisted so history follows the partner across devices. The chat
 * endpoint itself stays stateless; the client writes the message array back to
 * a conversation here after each completed turn. Partner-scoped throughout.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../helpers"
import { PARTNER_ASSISTANT_MODULE } from "../../../../modules/partner-assistant"
import type { CreateConversationInput } from "./validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const service: any = req.scope.resolve(PARTNER_ASSISTANT_MODULE)
  const conversations = await service.listConversationsForPartner(partner.id)

  return res.status(200).json({
    conversations,
    count: conversations.length,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateConversationInput>,
  res: MedusaResponse
) => {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }

  const body = req.validatedBody as CreateConversationInput
  const service: any = req.scope.resolve(PARTNER_ASSISTANT_MODULE)
  const conversation = await service.createConversationForPartner(partner.id, body)

  return res.status(201).json({ conversation })
}
