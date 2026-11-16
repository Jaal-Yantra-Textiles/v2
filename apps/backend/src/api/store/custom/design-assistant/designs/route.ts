import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { resolveOrCreateStudioDesignForCustomer } from "../../../../../mastra/agents/tools/storefront-design-flow"

/**
 * POST /store/custom/design-assistant/designs
 *
 * The signed-in buyer's open studio design — or a new empty one — with its
 * access token (#2543 phase 2). The storefront calls this server-side (it
 * holds the httpOnly session) when the buyer attaches photos before the chat
 * has made a design, then uploads the photos straight from the browser with
 * the returned token. Customer session required: guests verify their email
 * first.
 */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  const customerId = req.auth_context.actor_id
  const body = (req.body ?? {}) as { name?: unknown }
  const result = await resolveOrCreateStudioDesignForCustomer(
    req.scope as any,
    customerId,
    typeof body.name === "string" ? body.name.slice(0, 120) : undefined
  )
  res.status(result.created ? 201 : 200).json(result)
}
