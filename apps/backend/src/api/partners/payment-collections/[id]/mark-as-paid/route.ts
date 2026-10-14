import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { markPaymentCollectionAsPaid } from "@medusajs/medusa/core-flows"

import { assertPartnerOwnsPaymentCollection } from "../../ownership"

/**
 * Mark a partner's own order's payment collection as paid (offline payment).
 *
 * 🔴 The order is the one LINKED to the collection, never the body's: the body
 * used to be spread into the workflow input, so a caller could also swap
 * `payment_collection_id` or `captured_by`. Only `order_id` is read from the
 * body, and only to refuse a mismatch — partner-ui sends it, the MCP tool
 * does not.
 */
export const POST = async (
  req: AuthenticatedMedusaRequest<{ order_id?: string }>,
  res: MedusaResponse
) => {
  const paymentCollectionId = req.params.id
  const { order_id } = await assertPartnerOwnsPaymentCollection(
    req.auth_context,
    paymentCollectionId,
    req.scope
  )

  const claimed = (req.body as any)?.order_id
  if (claimed && claimed !== order_id) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      `Payment collection ${paymentCollectionId} does not belong to order ${claimed}`
    )
  }

  const { result } = await markPaymentCollectionAsPaid(req.scope).run({
    input: {
      payment_collection_id: paymentCollectionId,
      order_id,
      captured_by: req.auth_context.actor_id,
    },
  })

  res.json({ payment_collection: result })
}
