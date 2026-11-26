import {
  AuthenticatedMedusaRequest,
  MedusaResponse,
} from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { cancelOrderWorkflow } from "@medusajs/medusa/core-flows"

import { assertNotWorkOrder } from "../../../../partners/helpers"
import { canCustomerCancel, SELF_CANCEL_ORDER_FIELDS } from "../../self-cancel"

/**
 * POST /store/orders/:id/cancel — a signed-in customer cancels their own
 * order, only while nothing is paid or shipped (see self-cancel.ts).
 */
export const POST = async (
  req: AuthenticatedMedusaRequest,
  res: MedusaResponse
) => {
  const customerId = req.auth_context?.actor_id
  if (!customerId) {
    throw new MedusaError(MedusaError.Types.UNAUTHORIZED, "Sign in to cancel an order")
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
  const {
    data: [order],
  } = await query.graph({
    entity: "order",
    fields: SELF_CANCEL_ORDER_FIELDS,
    filters: { id: req.params.id },
  })

  if (!order) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, "Order not found")
  }

  const verdict = canCustomerCancel(order as any, customerId)
  if (!verdict.ok) {
    throw new MedusaError(
      verdict.reason === "Order not found"
        ? MedusaError.Types.NOT_FOUND
        : MedusaError.Types.NOT_ALLOWED,
      verdict.reason
    )
  }

  // A partner's work order is never the customer's to cancel.
  await assertNotWorkOrder(req.params.id, req.scope)

  await cancelOrderWorkflow(req.scope).run({
    input: { order_id: req.params.id, canceled_by: customerId },
  })

  res.json({ order: { id: req.params.id, status: "canceled" } })
}
