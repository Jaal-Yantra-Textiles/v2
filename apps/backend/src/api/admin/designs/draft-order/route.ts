import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import { createDesignDraftOrder, type CreateDesignOrderBody } from "./lib"

/**
 * POST /admin/designs/draft-order
 *
 * The customer-less twin of `POST /admin/customers/:id/design-order`: collate
 * selected designs into one draft order with **no buyer attached yet**.
 *
 * A `customer_id` in the body still attaches one when there is one to attach —
 * the customer route remains the addressable form for "this buyer's order", and
 * both go through the same function so they cannot drift.
 */
export const POST = async (
  req: MedusaRequest<CreateDesignOrderBody & { customer_id?: string | null }>,
  res: MedusaResponse
) => {
  const body = req.validatedBody as CreateDesignOrderBody & {
    customer_id?: string | null
  }
  await createDesignDraftOrder(req as any, res, body.customer_id?.trim() || null)
}
