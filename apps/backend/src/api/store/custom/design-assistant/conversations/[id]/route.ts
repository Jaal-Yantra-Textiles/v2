/**
 * Storefront design-assistant conversation — single-resource ops.
 *
 *   GET    /store/custom/design-assistant/conversations/:id  → full thread
 *   PATCH  /store/custom/design-assistant/conversations/:id  → rename / persist
 *            messages / link the design (once first generation creates it)
 *   DELETE /store/custom/design-assistant/conversations/:id  → delete
 *
 * Email-scoped: the service 404s a thread that isn't the maker email's, so
 * ids aren't cross-maker readable. Mirrors /admin/assistant/conversations/:id.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { STOREFRONT_DESIGN_ASSISTANT_MODULE } from "../../../../../../modules/storefront-design-assistant"
import type {
  DeleteDesignConversationInput,
  UpdateDesignConversationInput,
} from "../validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.query as { customer_email?: string; thread_key?: string }
  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const conversation = await service.getConversationForScope(
    {
      customer_email: query.customer_email ?? "",
      thread_key: query.thread_key ?? "",
    },
    req.params.id
  )
  return res.status(200).json({ conversation })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<UpdateDesignConversationInput>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as UpdateDesignConversationInput
  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const conversation = await service.updateConversationForScope(
    {
      customer_email: body.customer_email,
      thread_key: body.thread_key,
    },
    req.params.id,
    {
      title: body.title,
      design_id: body.design_id,
      messages: body.messages,
    }
  )
  return res.status(200).json({ conversation })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest<DeleteDesignConversationInput>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as DeleteDesignConversationInput
  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  await service.deleteConversationForScope(
    {
      customer_email: body.customer_email,
      thread_key: body.thread_key,
    },
    req.params.id
  )
  return res.status(200).json({ deleted: true })
}
