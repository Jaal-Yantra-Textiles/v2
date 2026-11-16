/**
 * Storefront design-assistant conversation — single-resource ops.
 *
 *   GET    /store/custom/design-assistant/conversations/:id  → full thread
 *   PATCH  /store/custom/design-assistant/conversations/:id  → rename / persist
 *            messages / link the design (once first generation creates it)
 *   DELETE /store/custom/design-assistant/conversations/:id  → delete
 *
 * 🔴 #2543: no longer email-scoped. The email was the only gate, so anyone who
 * knew a maker's email could read (and rewrite) their whole transcript. Each
 * op now requires the conversation token minted on create (`x-conversation-token`)
 * or a signed-in customer whose email is the thread's; anything else is the
 * same 404 a missing id gets. Mirrors /admin/assistant/conversations/:id.
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  assertDesignAccess,
  readConversationToken,
  readDesignCredentials,
} from "../../../../../../lib/design-access/authorize"
import { assertConversationAccess } from "../../../../../../lib/design-access/conversations"
import { STOREFRONT_DESIGN_ASSISTANT_MODULE } from "../../../../../../modules/storefront-design-assistant"
import type { UpdateDesignConversationInput } from "../validators"

const credentialsOf = (req: AuthenticatedMedusaRequest) => ({
  conversationToken: readConversationToken(req),
  customerId: readDesignCredentials(req).customerId,
})

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const conversation = await assertConversationAccess(
    req.scope as any,
    req.params.id,
    credentialsOf(req)
  )
  return res.status(200).json({ conversation })
}

export const PATCH = async (
  req: AuthenticatedMedusaRequest<UpdateDesignConversationInput>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as UpdateDesignConversationInput
  await assertConversationAccess(req.scope as any, req.params.id, credentialsOf(req))

  // Pointing a thread at a design is a claim on the design — prove that too.
  if (body.design_id) {
    await assertDesignAccess(req.scope as any, body.design_id, readDesignCredentials(req))
  }

  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const [conversation] = await service.updateStorefrontDesignConversations([
    {
      id: req.params.id,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.design_id !== undefined ? { design_id: body.design_id } : {}),
      // json column holds an array; cast past the object-narrowed typing.
      ...(body.messages !== undefined ? { messages: body.messages as any } : {}),
    },
  ])
  return res.status(200).json({ conversation })
}

export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  await assertConversationAccess(req.scope as any, req.params.id, credentialsOf(req))
  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  await service.deleteStorefrontDesignConversations(req.params.id)
  return res.status(200).json({ deleted: true })
}
