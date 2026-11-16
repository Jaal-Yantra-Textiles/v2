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
 * Public (guest makers), but NOT email-scoped any more (#2543): access is a
 * conversation token (minted on create, kept by the browser) or a signed-in
 * customer session — see lib/design-access/conversations.ts.
 * Mirrors /admin/assistant/conversations (#1092).
 */
import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"

import {
  assertDesignAccess,
  readDesignCredentials,
  resolveDesignAccess,
} from "../../../../../lib/design-access/authorize"
import { sessionCustomerEmail } from "../../../../../lib/design-access/conversations"
import {
  mintConversationAccessToken,
  mintDesignAccessToken,
} from "../../../../../lib/design-access/token"
import { STOREFRONT_DESIGN_ASSISTANT_MODULE } from "../../../../../modules/storefront-design-assistant"
import type { CreateDesignConversationInput } from "./validators"

/**
 * 🔴 #2543: the list used to be `?customer_email=…` and nothing else, so
 * anyone who knew a maker's email could read every thread they had. It now
 * answers ONLY for a signed-in customer (their own email, from the session);
 * a guest — or anyone sending just an email — gets an empty list. Guests keep
 * their threads through the conversation token stored with the local thread.
 *
 * Each row carries the tokens the browser needs to keep working with it: a
 * conversation token, and a design token when the session owns the design.
 */
export const GET = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const query = req.query as { thread_key?: string }
  const { customerId } = readDesignCredentials(req)
  const email = await sessionCustomerEmail(req.scope as any, customerId)
  const threadKey = String(query.thread_key ?? "").trim()

  if (!email || !threadKey) {
    return res.status(200).json({ conversations: [], count: 0 })
  }

  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const rows: any[] = await service.listConversationsForScope({
    customer_email: email,
    thread_key: threadKey,
  })

  const conversations = await Promise.all(
    rows.map(async (row) => {
      const grant = row.design_id
        ? await resolveDesignAccess(req.scope as any, row.design_id, {
            customerId,
          })
        : null
      return {
        ...row,
        conversation_token: mintConversationAccessToken(row.id),
        design_token: grant
          ? mintDesignAccessToken(row.design_id, grant.customer_id)
          : null,
      }
    })
  )

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
  const credentials = readDesignCredentials(req)

  // Linking a thread to a design is a claim on that design — prove it.
  if (body.design_id) {
    await assertDesignAccess(req.scope as any, body.design_id, credentials)
  }

  // A signed-in maker's thread is filed under their own email, whatever the
  // body says.
  const sessionEmail = await sessionCustomerEmail(
    req.scope as any,
    credentials.customerId
  )

  const service: any = req.scope.resolve(STOREFRONT_DESIGN_ASSISTANT_MODULE)
  const conversation = await service.createConversationForScope(
    {
      customer_email: sessionEmail ?? body.customer_email,
      thread_key: body.thread_key,
    },
    {
      title: body.title,
      design_id: body.design_id,
      messages: body.messages,
    }
  )

  return res.status(201).json({
    conversation,
    conversation_token: mintConversationAccessToken(conversation.id),
  })
}
