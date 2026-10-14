import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { createOrderPaymentCollectionWorkflow } from "@medusajs/medusa/core-flows"

import { validatePartnerOrderOwnership } from "../helpers"

/**
 * Open a payment collection on a partner's own order.
 *
 * 🔴 This used to pass the raw body to `createPaymentCollections`: any partner
 * could mint a collection, linked to no order at all, with any fields. Now it
 * takes only `order_id` (which the partner must own) and `amount`, and the
 * core workflow links the collection to that order.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<{ order_id?: string; amount?: number }>,
  res: MedusaResponse
) => {
  const body = (req.body ?? {}) as { order_id?: unknown; amount?: unknown }
  const orderId = typeof body.order_id === "string" ? body.order_id : ""
  const amount = Number(body.amount)

  if (!orderId) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "order_id is required")
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "amount must be a positive number"
    )
  }

  await validatePartnerOrderOwnership(req.auth_context, orderId, req.scope)

  const { result } = await createOrderPaymentCollectionWorkflow(req.scope).run({
    input: { order_id: orderId, amount },
  })
  const paymentCollection = Array.isArray(result) ? result[0] : result

  res.json({ payment_collection: paymentCollection })
}
