/**
 * Admin assistant conversation — single-resource ops (#1092).
 *
 *   GET    /admin/assistant/conversations/:id  → full conversation (messages)
 *   PATCH  /admin/assistant/conversations/:id  → rename / persist messages
 *   DELETE /admin/assistant/conversations/:id  → delete
 *
 * All user-scoped: the service 404s a conversation that isn't the authenticated
 * user's, so ids aren't cross-user readable.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { ADMIN_ASSISTANT_MODULE } from "../../../../../modules/admin-assistant"
import type { UpdateConversationInput } from "../validators"

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
  const conversation = await service.getConversationForUser(
    userId,
    req.params.id
  )
  return res.status(200).json({ conversation })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<UpdateConversationInput>,
  res: MedusaResponse
) => {
  const userId = requireUserId(req)
  const body = req.validatedBody as UpdateConversationInput
  const service: any = req.scope.resolve(ADMIN_ASSISTANT_MODULE)
  const conversation = await service.updateConversationForUser(
    userId,
    req.params.id,
    body
  )
  return res.status(200).json({ conversation })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const userId = requireUserId(req)
  const service: any = req.scope.resolve(ADMIN_ASSISTANT_MODULE)
  await service.deleteConversationForUser(userId, req.params.id)
  return res
    .status(200)
    .json({ id: req.params.id, object: "conversation", deleted: true })
}
