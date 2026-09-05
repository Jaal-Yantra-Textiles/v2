import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"

import {
  createDesignDraftOrder,
  type CreateDesignOrderBody,
} from "../../../designs/draft-order/lib"

/**
 * POST /admin/customers/:id/design-order
 *
 * Collate selected designs into one draft order FOR THIS CUSTOMER.
 *
 * The work lives in `designs/draft-order/lib` because there is now a
 * customer-less twin (`POST /admin/designs/draft-order`) — most designs never
 * carry a customer link, and refusing to create an order for them was refusing
 * the ordinary case. One function, two ways in.
 */
export const POST = async (
  req: MedusaRequest<CreateDesignOrderBody>,
  res: MedusaResponse
) => {
  const { id: customer_id } = req.params
  await createDesignDraftOrder(req, res, customer_id)
}
