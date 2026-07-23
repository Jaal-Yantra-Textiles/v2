/**
 * Partner assistant conversation — single-resource ops (#338 item 2).
 *
 *   GET    /partners/assistant/conversations/:id  → full conversation (messages)
 *   PATCH  /partners/assistant/conversations/:id  → rename / persist messages
 *   DELETE /partners/assistant/conversations/:id  → delete
 *
 * All partner-scoped: the service 404s a conversation that isn't the
 * authenticated partner's, so ids aren't cross-tenant readable.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { getPartnerFromAuthContext } from "../../../helpers"
import { PARTNER_ASSISTANT_MODULE } from "../../../../../modules/partner-assistant"
import type { UpdateConversationInput } from "../validators"

async function requirePartner(req: AuthenticatedMedusaRequest) {
  const partner = await getPartnerFromAuthContext(req.auth_context, req.scope)
  if (!partner?.id) {
    throw new MedusaError(
      MedusaError.Types.UNAUTHORIZED,
      "Partner authentication required"
    )
  }
  return partner
}

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await requirePartner(req)
  const service: any = req.scope.resolve(PARTNER_ASSISTANT_MODULE)
  const conversation = await service.getConversationForPartner(
    partner.id,
    req.params.id
  )
  return res.status(200).json({ conversation })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<UpdateConversationInput>,
  res: MedusaResponse
) => {
  const partner = await requirePartner(req)
  const body = req.validatedBody as UpdateConversationInput
  const service: any = req.scope.resolve(PARTNER_ASSISTANT_MODULE)
  const conversation = await service.updateConversationForPartner(
    partner.id,
    req.params.id,
    body
  )
  return res.status(200).json({ conversation })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const partner = await requirePartner(req)
  const service: any = req.scope.resolve(PARTNER_ASSISTANT_MODULE)
  await service.deleteConversationForPartner(partner.id, req.params.id)
  return res
    .status(200)
    .json({ id: req.params.id, object: "conversation", deleted: true })
}
