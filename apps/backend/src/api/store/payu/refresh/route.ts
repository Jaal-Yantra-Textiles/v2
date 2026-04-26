import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { refreshPaymentCollectionForCartWorkflow } from "@medusajs/medusa/core-flows"

/**
 * POST /store/payu/refresh
 * Refreshes the payment collection for a cart — deletes old sessions
 * so a fresh session (new txnid) can be created on retry.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
  const { cart_id } = req.body as { cart_id?: string }

  if (!cart_id) {
    return res.status(400).json({ message: "cart_id is required" })
  }

  try {
    await refreshPaymentCollectionForCartWorkflow(req.scope).run({
      input: { cart_id },
    })

    return res.json({ message: "Payment collection refreshed" })
  } catch (e: any) {
    console.error("[PayU Refresh] Failed:", e.message)
    return res.status(500).json({
      message: "Failed to refresh payment collection",
      error: e.message,
    })
  }
}
