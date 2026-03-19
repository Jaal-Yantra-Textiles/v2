import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"
import {
  completeCartWorkflow,
  refreshPaymentCollectionForCartWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * POST /store/payu/complete
 * Called by the storefront after PayU redirects back (success or failure).
 *
 * Success: updates session data with PayU response, completes cart.
 * Failure: refreshes payment collection so customer can retry with fresh txnid.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const {
    cart_id,
    payu_status,
    mihpayid,
    txnid,
    hash,
    amount,
  } = req.body as Record<string, string>

  if (!cart_id) {
    return res.status(400).json({ message: "cart_id is required" })
  }

  // If PayU reported failure, just refresh the payment collection and return
  if (payu_status && payu_status !== "success") {
    console.log(`[PayU Complete] Payment failed (${payu_status}), refreshing collection for cart ${cart_id}`)
    await refreshPaymentCollection(req, cart_id)
    return res.json({ type: "cart", error: "Payment failed" })
  }

  const query = req.scope.resolve("query")
  const paymentModule = req.scope.resolve(Modules.PAYMENT) as any

  // 1. Retrieve the cart with payment collection
  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "payment_collection.id",
      "payment_collection.payment_sessions.*",
    ],
    filters: { id: cart_id },
  })

  const cart = carts?.[0] as any
  if (!cart) {
    return res.status(404).json({ message: "Cart not found" })
  }

  const paymentSession = cart.payment_collection?.payment_sessions?.find(
    (s: any) => s.provider_id?.startsWith("pp_payu")
  )

  if (!paymentSession) {
    return res.status(400).json({ message: "No PayU payment session found" })
  }

  // 2. Update the payment session data with PayU's response
  try {
    await paymentModule.updatePaymentSession({
      id: paymentSession.id,
      currency_code: paymentSession.currency_code,
      amount: paymentSession.amount,
      data: {
        ...(paymentSession.data || {}),
        payu_status: payu_status || "",
        mihpayid: mihpayid || "",
        txnid: txnid || (paymentSession.data?.txnid as string) || "",
        payu_hash: hash || "",
        payu_amount: amount || "",
        status: "success",
      },
    })
  } catch (e: any) {
    console.error("[PayU Complete] Failed to update session:", e.message)
    await refreshPaymentCollection(req, cart_id)
    return res.status(500).json({
      type: "cart",
      message: "Failed to update payment session",
      error: e.message,
    })
  }

  // 3. Complete the cart
  try {
    const { result } = await completeCartWorkflow(req.scope).run({
      input: { id: cart_id },
    })

    // completeCartWorkflow returns { id: orderId } on success
    if (result?.id) {
      return res.json({
        type: "order",
        order_id: result.id,
      })
    }

    // No order ID — payment was not authorized. Refresh for retry.
    await refreshPaymentCollection(req, cart_id)
    return res.json({
      type: "cart",
      error: "Payment not authorized",
    })
  } catch (e: any) {
    console.error("[PayU Complete] Cart completion failed:", e.message)
    await refreshPaymentCollection(req, cart_id)
    return res.status(500).json({
      type: "cart",
      message: "Cart completion failed",
      error: e.message,
    })
  }
}

/**
 * Refresh the payment collection — deletes all existing sessions and resets
 * the collection so a new payment session (with a fresh txnid) can be created.
 */
async function refreshPaymentCollection(req: MedusaRequest, cartId: string) {
  try {
    await refreshPaymentCollectionForCartWorkflow(req.scope).run({
      input: { cart_id: cartId },
    })
    console.log(`[PayU Complete] Payment collection refreshed for cart ${cartId}`)
  } catch (e: any) {
    console.error("[PayU Complete] Failed to refresh payment collection:", e.message)
  }
}
