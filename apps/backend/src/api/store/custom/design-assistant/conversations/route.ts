/**
 * Storefront design-assistant conversation history (chat design editor).
 *
 *   GET  /store/custom/design-assistant/conversations  → this maker's threads
 *        for a thread key (light: no message bodies)
 *   POST /store/custom/design-assistant/conversations  → create a thread
 *
 * Server-persisted so a maker's design threads follow them across devices and
 * survive localStorage clears; reopening replays the thread exactly and
 * continues it. The chat endpoint itself stays stateless — the design-chat
 * client writes the message array back here after each completed turn.
 *
 * Public (no customer auth) — mirrors the chat flow's email gate. Scoping is
 * by normalised maker email + thread key (the service normalises + asserts).
 * Mirrors /admin/assistant/conversations (#1092).
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { STOREFRONT_DESIGN_ASSISTANT_MODULE } from "../../../../../modules/storefront-design-assistant"
import type { CreateDesignConversationInput } from "./validators"

export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.query as { customer_email?: string; thread_key?: string }
  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const conversations = await service.listConversationsForScope({
    customer_email: query.customer_email ?? "",
    thread_key: query.thread_key ?? "",
  })

  return res.status(200).json({
    conversations,
    count: conversations.length,
  })
}

export const POST = async (
  req: AuthenticatedMedusaRequest<CreateDesignConversationInput>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as CreateDesignConversationInput
  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const conversation = await service.createConversationForScope(
    {
      customer_email: body.customer_email,
      thread_key: body.thread_key,
    },
    {
      title: body.title,
      design_id: body.design_id,
      messages: body.messages,
    }
  )

  return res.status(201).json({ conversation })
}
