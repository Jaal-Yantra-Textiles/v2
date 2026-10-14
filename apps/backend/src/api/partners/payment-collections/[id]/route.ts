import { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError, Modules } from "@medusajs/framework/utils"

import { assertPartnerOwnsPaymentCollection } from "../ownership"

/**
 * Delete an UNPAID payment collection on a partner's own order.
 *
 * 🔴 Ownership is checked through the collection's order link (see
 * `ownership.ts`). A collection that has taken money is refused: deleting it
 * would erase the record of a payment, which no partner action should do.
 */
export const DELETE = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const { status } = await assertPartnerOwnsPaymentCollection(
    req.auth_context,
    req.params.id,
    req.scope
  )

  if (status !== "not_paid") {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      `Only an unpaid payment collection can be deleted (this one is ${status ?? "unknown"})`
    )
  }

  const paymentService = req.scope.resolve(Modules.PAYMENT) as any
  await paymentService.deletePaymentCollections(req.params.id)

  res.json({ id: req.params.id, object: "payment-collection", deleted: true })
}
