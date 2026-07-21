/**
 * Admin assistant conversation history (#1092).
 *
 *   GET  /admin/assistant/conversations   → list this user's saved chats
 *                                           (light: no message bodies)
 *   POST /admin/assistant/conversations   → create a new conversation
 *
 * Server-persisted so history follows the operator across devices. The chat
 * endpoint itself stays stateless; the client writes the message array back to
 * a conversation here after each completed turn. Scoped to the authenticated
 * admin user throughout. Mirrors /partners/assistant/conversations.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ADMIN_ASSISTANT_MODULE } from "../../../../modules/admin-assistant"
import type { CreateConversationInput } from "./validators"

function requireUserId(req: AuthenticatedMedusaRequest): string {
  const userId = req.auth_context?.actor_id
  if (!userId) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Admin authentication required"
    )
  }
  return userId
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const userId = requireUserId(req)
  const service: any = req.scope.resolve(ADMIN_ASSISTANT_MODULE)
  const conversations = await service.listConversationsForUser(userId)

  return res.status(200).json({
    conversations,
    count: conversations.length,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateConversationInput>,
  res: MedusaResponse
) => {
  const userId = requireUserId(req)
  const body = req.validatedBody as CreateConversationInput
  const service: any = req.scope.resolve(ADMIN_ASSISTANT_MODULE)
  const conversation = await service.createConversationForUser(userId, body)

  return res.status(201).json({ conversation })
}
