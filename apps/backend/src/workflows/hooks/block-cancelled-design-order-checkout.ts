import { completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { MedusaError } from "@medusajs/framework/utils"

/**
 * A cancelled design order cannot be checked out.
 *
 * Cancelling a design order is a stamp on its cart (`metadata.cancelled_at`,
 * see `decideCancel`). The admin detail page stops showing the checkout link
 * and the `/r/cart/:id` redirect sends the buyer to the shop instead, but a
 * buyer who still has the cart open, or the raw cart id, could complete it
 * through the store API: nothing on the checkout path read the stamp. That
 * is a payment taken for an order we told the buyer is off.
 *
 * `validate` runs before payment authorization, so refusing here takes no
 * money.
 */
completeCartWorkflow.hooks.validate(async ({ cart }) => {
  const cancelledAt = (cart as any)?.metadata?.cancelled_at
  if (typeof cancelledAt === "string" && cancelledAt.trim()) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "This order was cancelled and can no longer be paid for. Please contact us for a new link."
    )
  }
})
