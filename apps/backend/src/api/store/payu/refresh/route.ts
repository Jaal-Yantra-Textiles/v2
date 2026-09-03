import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { refreshCartPaymentCollection } from "../../../../lib/payments/ensure-cart-collection"

/**
 * POST /store/payu/refresh
 * Refreshes the payment collection for a cart — deletes old sessions
 * so a fresh session (new txnid) can be created on retry.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const logger: any = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const { cart_id } = req.body as { cart_id?: string }

  if (!cart_id) {
    return res.status(400).json({ message: "cart_id is required" })
  }

  try {
    /**
     * 🔴 NOT core's refresh (#1451). It resets the collection to the cart's
     * full total whenever the two differ — which a DEPOSIT does by definition.
     * This route exists for the retry path, so using core's workflow here would
     * mean: first attempt asks for the deposit, retry asks for 100%.
     */
    const query: any = req.scope.resolve(ContainerRegistrationKeys.QUERY)
    const { data } = await query.graph({
      entity: "cart",
      fields: [
        "id",
        "total",
        "currency_code",
        "payment_collection.id",
        "payment_collection.amount",
        "payment_collection.payment_sessions.id",
      ],
      filters: { id: cart_id },
    })
    const cart = data?.[0]
    if (!cart) {
      return res.status(404).json({ message: "Cart not found" })
    }

    const { preserved_deposit } = await refreshCartPaymentCollection(req.scope, cart)

    return res.json({
      message: "Payment collection refreshed",
      // Reported rather than silent: "we kept your deposit" is the fact a
      // support conversation about a retried payment turns on.
      preserved_deposit,
    })
  } catch (e: any) {
    logger.error(`[PayU Refresh] Failed: ${e.message}`)
    return res.status(500).json({
      message: "Failed to refresh payment collection",
      error: e.message,
    })
  }
}
